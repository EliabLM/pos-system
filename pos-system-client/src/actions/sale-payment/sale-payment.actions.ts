'use server';

import { SalePayment, Prisma, MembershipRole } from '@/generated/prisma';
import { ActionResponse, Serialized } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma, serializeDecimals } from '../utils';
import {
  idSchema,
  salePaymentInputSchema,
  updateSalePaymentInputSchema,
  type SalePaymentInput,
  type UpdateSalePaymentInput,
} from '../sale/sale.schemas';

const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;
const invalidInput = (message: string) => ({ status: 400, message, data: null }) as const;

const salePaymentInclude: Prisma.SalePaymentInclude = {
  sale: {
    select: {
      id: true,
      saleNumber: true,
      total: true,
      status: true,
      saleDate: true,
    },
  },
  paymentMethod: true,
};

// ===========================
// SALE PAYMENT ACTIONS
// ===========================

// ADD SALE PAYMENT
export const addSalePayment = async (
  saleIdInput: string,
  paymentInput: SalePaymentInput
): Promise<ActionResponse<Serialized<SalePayment> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(saleIdInput);
    if (!id.success) return invalidInput('ID de venta es requerido');
    const parsed = salePaymentInputSchema.safeParse(paymentInput);
    if (!parsed.success) return invalidInput('El monto del pago debe ser mayor a 0');
    const saleId = id.data;
    const paymentData = parsed.data;

    // Verificar que la venta existe en la organización
    const sale = await prisma.sale.findFirst({
      where: { id: saleId, organizationId: actor.organizationId, isDeleted: false },
      include: {
        salePayments: {
          where: { isDeleted: false },
        },
      },
    });

    if (!sale) {
      return { status: 404, message: 'Venta no encontrada', data: null };
    }

    if (sale.status === 'CANCELLED') {
      return {
        status: 400,
        message: 'No se pueden agregar pagos a una venta cancelada',
        data: null,
      };
    }

    // Calcular monto pagado actual
    const currentPaidAmount = sale.salePayments.reduce(
      (sum, payment) => sum + payment.amount.toNumber(),
      0
    );
    const remainingAmount = sale.total.toNumber() - currentPaidAmount;

    if (paymentData.amount > remainingAmount) {
      return {
        status: 400,
        message: `El monto excede el saldo pendiente de ${remainingAmount}`,
        data: null,
      };
    }

    // Verificar método de pago
    const paymentMethod = await prisma.paymentMethod.findFirst({
      where: {
        id: paymentData.paymentMethodId,
        organizationId: sale.organizationId,
        isDeleted: false,
        isActive: true,
      },
    });

    if (!paymentMethod) {
      return {
        status: 400,
        message: 'Método de pago no válido',
        data: null,
      };
    }

    // Crear pago y actualizar estado de venta en transacción
    const newPayment = await prisma.$transaction(async (tx) => {
      // Crear el pago
      const payment = await tx.salePayment.create({
        data: {
          saleId,
          paymentMethodId: paymentData.paymentMethodId,
          amount: paymentData.amount,
          reference: paymentData.reference ?? null,
          notes: paymentData.notes ?? null,
          paymentDate: paymentData.paymentDate ?? new Date(),
        },
        include: salePaymentInclude,
      });

      // Calcular nuevo monto pagado
      const newPaidAmount = currentPaidAmount + paymentData.amount;
      const isFullyPaid = Math.abs(newPaidAmount - sale.total.toNumber()) < 0.01;

      // Actualizar estado de la venta
      let newStatus = sale.status;
      let paidDate = sale.paidDate;

      if (isFullyPaid && sale.status === 'PENDING') {
        newStatus = 'PAID';
        paidDate = new Date();
      }

      await tx.sale.update({
        where: { id: saleId },
        data: {
          status: newStatus,
          paidDate,
          updatedAt: new Date(),
        },
      });

      return payment;
    });

    return {
      status: 201,
      message: 'Pago agregado exitosamente',
      data: serializeDecimals(newPayment),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error adding sale payment:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2003') {
        return {
          status: 400,
          message: 'Una de las referencias especificadas no existe',
          data: null,
        };
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// UPDATE SALE PAYMENT
export const updateSalePayment = async (
  paymentIdInput: string,
  updateInput: UpdateSalePaymentInput
): Promise<ActionResponse<Serialized<SalePayment> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(paymentIdInput);
    if (!id.success) return invalidInput('ID del pago es requerido');
    const parsed = updateSalePaymentInputSchema.safeParse(updateInput);
    if (!parsed.success) return invalidInput('Datos del pago inválidos');
    const paymentId = id.data;
    const updateData = parsed.data;

    const existingPayment = await prisma.salePayment.findFirst({
      where: {
        id: paymentId,
        isDeleted: false,
        sale: { organizationId: actor.organizationId, isDeleted: false },
      },
      include: {
        sale: {
          include: {
            salePayments: {
              where: { isDeleted: false },
            },
          },
        },
      },
    });

    if (!existingPayment) {
      return { status: 404, message: 'Pago no encontrado', data: null };
    }

    if (existingPayment.sale.status === 'CANCELLED') {
      return {
        status: 400,
        message: 'No se pueden modificar pagos de una venta cancelada',
        data: null,
      };
    }

    // Validar nuevo monto si se está actualizando
    if (updateData.amount !== undefined) {
      if (updateData.amount <= 0) {
        return {
          status: 400,
          message: 'El monto debe ser mayor a 0',
          data: null,
        };
      }

      const otherPayments = existingPayment.sale.salePayments.filter(
        (p) => p.id !== paymentId
      );
      const otherPaymentsTotal = otherPayments.reduce(
        (sum, payment) => sum + payment.amount.toNumber(),
        0
      );
      const newTotal = otherPaymentsTotal + updateData.amount;

      if (newTotal > existingPayment.sale.total.toNumber()) {
        return {
          status: 400,
          message: 'El nuevo monto excede el total de la venta',
          data: null,
        };
      }
    }

    const updatedPayment = await prisma.salePayment.update({
      where: { id: paymentId },
      data: {
        amount: updateData.amount,
        reference: updateData.reference,
        notes: updateData.notes,
        paymentDate: updateData.paymentDate,
        updatedAt: new Date(),
      },
      include: salePaymentInclude,
    });

    return {
      status: 200,
      message: 'Pago actualizado exitosamente',
      data: serializeDecimals(updatedPayment),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error updating sale payment:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        return { status: 404, message: 'Pago no encontrado', data: null };
      }
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// DELETE SALE PAYMENT
export const deleteSalePayment = async (paymentIdInput: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(paymentIdInput);
    if (!id.success) return invalidInput('ID del pago es requerido');
    const paymentId = id.data;

    const existingPayment = await prisma.salePayment.findFirst({
      where: {
        id: paymentId,
        isDeleted: false,
        sale: { organizationId: actor.organizationId, isDeleted: false },
      },
      include: {
        sale: {
          include: {
            salePayments: {
              where: { isDeleted: false },
            },
          },
        },
      },
    });

    if (!existingPayment) {
      return { status: 404, message: 'Pago no encontrado', data: null };
    }

    if (existingPayment.sale.status === 'CANCELLED') {
      return {
        status: 400,
        message: 'No se pueden eliminar pagos de una venta cancelada',
        data: null,
      };
    }

    // Eliminar pago y actualizar estado de venta en transacción
    await prisma.$transaction(async (tx) => {
      // Soft delete del pago
      await tx.salePayment.update({
        where: { id: paymentId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Recalcular estado de la venta
      const remainingPayments = existingPayment.sale.salePayments.filter(
        (p) => p.id !== paymentId
      );
      const newPaidAmount = remainingPayments.reduce(
        (sum, payment) => sum + payment.amount.toNumber(),
        0
      );
      const isFullyPaid =
        Math.abs(newPaidAmount - existingPayment.sale.total.toNumber()) < 0.01;

      let newStatus = existingPayment.sale.status;
      let paidDate = existingPayment.sale.paidDate;

      if (!isFullyPaid && existingPayment.sale.status === 'PAID') {
        newStatus = 'PENDING';
        paidDate = null;
      }

      await tx.sale.update({
        where: { id: existingPayment.saleId },
        data: {
          status: newStatus,
          paidDate,
          updatedAt: new Date(),
        },
      });
    });

    return {
      status: 200,
      message: 'Pago eliminado exitosamente',
      data: null,
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error deleting sale payment:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// GET SALE PAYMENTS BY SALE ID
export const getSalePaymentsBySaleId = async (
  saleIdInput: string
): Promise<ActionResponse<Serialized<SalePayment>[] | null>> => {
  try {
    const actor = await requireActor();
    const id = idSchema.safeParse(saleIdInput);
    if (!id.success) return invalidInput('ID de venta es requerido');

    const payments = await prisma.salePayment.findMany({
      where: {
        saleId: id.data,
        isDeleted: false,
        sale: { organizationId: actor.organizationId, isDeleted: false },
      },
      include: salePaymentInclude,
      orderBy: { paymentDate: 'desc' },
    });

    return {
      status: 200,
      message: 'Pagos de venta obtenidos exitosamente',
      data: serializeDecimals(payments),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching sale payments:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};
