import { Prisma, PrismaClient, Sale } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import type { Actor } from '@/lib/auth/actor';
import { recordStockMovement, StockMovementError } from '../stock-movement/record-stock-movement';
import { calculateSaleTotals } from './sale-totals';
import { saleInclude } from './sale.include';
import { createSaleInputSchema, idSchema, type CreateSaleInput } from './sale.schemas';

/**
 * Registro y anulación de ventas para un actor ya autorizado. NO son server
 * actions: `createSale`/`cancelSale` resuelven el actor de la sesión y llaman
 * aquí con el cliente de Prisma compartido. Recibir el cliente permite probar
 * contra PostgreSQL real sin la sesión de Next.
 */

const invalidInput = (message = 'Datos inválidos') =>
  ({ status: 400, message, data: null }) as const;
const internalError = () =>
  ({ status: 500, message: 'Error interno del servidor', data: null }) as const;
const saleNotFound = () =>
  ({ status: 404, message: 'Venta no encontrada', data: null }) as const;

const formatSaleNumber = (prefix: string, n: number) => `${prefix}-${String(n).padStart(6, '0')}`;

export const createSaleForActor = async (
  db: PrismaClient,
  actor: Actor,
  input: CreateSaleInput
): Promise<ActionResponse<Sale | null>> => {
  try {
    const parsed = createSaleInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error.issues[0]?.message ?? 'Datos de venta inválidos');
    }
    const { saleData, saleItems, salePayments } = parsed.data;
    const orgId = actor.organizationId;

    // Un vendedor con tienda asignada solo vende en su tienda
    if (actor.role === 'SELLER' && actor.storeId && saleData.storeId !== actor.storeId) {
      return {
        status: 403,
        message: 'Solo puedes registrar ventas en tu tienda asignada',
        data: null,
      };
    }

    // Verificar que la tienda existe y pertenece a la organización
    const store = await db.store.findFirst({
      where: { id: saleData.storeId, organizationId: orgId, isDeleted: false },
    });
    if (!store) return invalidInput('La tienda especificada no existe');

    // Verificar cliente si se especifica
    if (saleData.customerId) {
      const customer = await db.customer.findFirst({
        where: { id: saleData.customerId, organizationId: orgId, isDeleted: false },
        select: { id: true },
      });
      if (!customer) return invalidInput('El cliente especificado no existe');
    }

    // Verificar productos (el stock se descuenta y comprueba dentro de la transacción)
    const productIds = [...new Set(saleItems.map((item) => item.productId))];
    const products = await db.product.findMany({
      where: { id: { in: productIds }, organizationId: orgId, isDeleted: false, isActive: true },
    });
    if (products.length !== productIds.length) {
      return invalidInput('Uno o más productos no existen o están inactivos');
    }

    // Calcular totales (siempre en el servidor)
    const { subtotal, total } = calculateSaleTotals(saleItems);

    // Validar pagos si se proporcionan
    if (salePayments && salePayments.length > 0) {
      const totalPayments = salePayments.reduce((sum, payment) => sum + payment.amount, 0);
      if (Math.abs(totalPayments - total) > 0.01) {
        return invalidInput('El total de pagos no coincide con el total de la venta');
      }

      const paymentMethodIds = [...new Set(salePayments.map((p) => p.paymentMethodId))];
      const paymentMethods = await db.paymentMethod.findMany({
        where: { id: { in: paymentMethodIds }, organizationId: orgId, isDeleted: false, isActive: true },
      });
      if (paymentMethods.length !== paymentMethodIds.length) {
        return invalidInput('Uno o más métodos de pago no son válidos');
      }
    }

    const newSale = await db.$transaction(
      async (tx) => {
        // Consecutivo con incremento atómico (UPDATE ... RETURNING). Bloquea la
        // fila de la tienda hasta el commit: las ventas de una tienda se
        // numeran en orden y un rollback no consume número.
        const counter = await tx.store.update({
          where: { id: saleData.storeId, organizationId: orgId, isDeleted: false },
          data: { lastSaleNumber: { increment: 1 } },
          select: { saleNumberPrefix: true, lastSaleNumber: true },
        });
        const saleNumber = formatSaleNumber(counter.saleNumberPrefix, counter.lastSaleNumber);

        // Lista blanca de campos; identidad y tenant del actor
        const sale = await tx.sale.create({
          data: {
            organizationId: orgId,
            storeId: saleData.storeId,
            userId: actor.userId,
            customerId: saleData.customerId ?? null,
            status: saleData.status,
            saleDate: saleData.saleDate ?? new Date(),
            dueDate: saleData.status === 'PENDING' ? saleData.dueDate ?? null : null,
            paidDate: saleData.status === 'PAID' ? new Date() : null,
            notes: saleData.notes ?? null,
            saleNumber,
            subtotal,
            total,
          },
        });

        // Orden fijo por producto: dos ventas con los mismos productos bloquean
        // las filas en el mismo orden y no se interbloquean.
        const orderedItems = [...saleItems].sort((a, b) => a.productId.localeCompare(b.productId));
        for (const itemData of orderedItems) {
          await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: itemData.productId,
              unitMeasureId: itemData.unitMeasureId ?? null,
              quantity: itemData.quantity,
              unitPrice: itemData.unitPrice,
              subtotal: itemData.quantity * itemData.unitPrice,
            },
          });

          await recordStockMovement(tx, orgId, actor.userId, {
            productId: itemData.productId,
            storeId: saleData.storeId,
            type: 'OUT',
            quantity: itemData.quantity,
            reason: `Venta ${sale.saleNumber}`,
            reference: sale.id,
          });
        }

        if (salePayments && salePayments.length > 0) {
          for (const paymentData of salePayments) {
            await tx.salePayment.create({
              data: {
                saleId: sale.id,
                paymentMethodId: paymentData.paymentMethodId,
                amount: paymentData.amount,
                reference: paymentData.reference ?? null,
                notes: paymentData.notes ?? null,
                paymentDate: paymentData.paymentDate ?? new Date(),
              },
            });
          }
        }

        return tx.sale.findUnique({ where: { id: sale.id }, include: saleInclude });
      },
      { maxWait: 10000, timeout: 30000 }
    );

    return { status: 201, message: 'Venta creada exitosamente', data: newSale };
  } catch (error) {
    if (error instanceof StockMovementError) return invalidInput(error.message);
    console.error('Error creating sale:', error);
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return { status: 409, message: 'Ya existe una venta con ese número', data: null };
      }
      if (error.code === 'P2003') {
        return invalidInput('Una de las referencias especificadas no existe');
      }
    }
    return internalError();
  }
};

export const cancelSaleForActor = async (
  db: PrismaClient,
  actor: Actor,
  saleId: string,
  reason?: string
): Promise<ActionResponse<Sale | null>> => {
  try {
    const id = idSchema.safeParse(saleId);
    if (!id.success) return invalidInput('ID de venta es requerido');
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 1000)) {
      return invalidInput('Motivo de cancelación inválido');
    }

    const existingSale = await db.sale.findFirst({
      where: { id: id.data, organizationId: actor.organizationId, isDeleted: false },
      include: { saleItems: { where: { isDeleted: false } } },
    });
    if (!existingSale) return saleNotFound();
    if (existingSale.status === 'CANCELLED') return invalidInput('La venta ya está cancelada');

    const cancelledSale = await db.$transaction(
      async (tx) => {
        // La condición de estado hace fallar (P2025) una segunda anulación simultánea.
        await tx.sale.update({
          where: { id: existingSale.id, status: { not: 'CANCELLED' } },
          data: {
            status: 'CANCELLED',
            notes: reason ? `${existingSale.notes || ''}\nCANCELADO: ${reason}` : existingSale.notes,
            updatedAt: new Date(),
          },
        });

        const orderedItems = [...existingSale.saleItems].sort((a, b) => a.productId.localeCompare(b.productId));
        for (const item of orderedItems) {
          await recordStockMovement(tx, actor.organizationId, actor.userId, {
            productId: item.productId,
            storeId: existingSale.storeId,
            type: 'IN',
            quantity: item.quantity,
            reason: `Cancelación de venta ${existingSale.saleNumber}`,
            reference: existingSale.id,
          });
        }

        return tx.sale.findUnique({ where: { id: existingSale.id }, include: saleInclude });
      },
      { maxWait: 10000, timeout: 30000 }
    );

    return { status: 200, message: 'Venta cancelada exitosamente', data: cancelledSale };
  } catch (error) {
    if (error instanceof StockMovementError) return invalidInput(error.message);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return invalidInput('La venta ya está cancelada');
    }
    console.error('Error cancelling sale:', error);
    return internalError();
  }
};
