'use server';

import { SaleItem, Prisma, MembershipRole } from '@/generated/prisma';
import { ActionResponse, Serialized } from '@/interfaces';
import { actorErrorResponse, requireActor } from '@/lib/auth/actor';
import { prisma, serializeDecimals } from '../utils';
import { calculateSaleTotals } from '../sale/sale-totals';
import {
  idSchema,
  saleItemInputSchema,
  updateSaleItemInputSchema,
  type SaleItemInput,
  type UpdateSaleItemInput,
} from '../sale/sale.schemas';

const ADMIN_ONLY = { roles: [MembershipRole.ADMIN] } as const;
const invalidInput = (message: string) => ({ status: 400, message, data: null }) as const;

const saleItemInclude: Prisma.SaleItemInclude = {
  sale: {
    select: {
      id: true,
      saleNumber: true,
      total: true,
      status: true,
      saleDate: true,
    },
  },
  product: {
    include: {
      brand: true,
      category: true,
      unitMeasure: true,
    },
  },
  unitMeasure: true,
};

// ===========================
// SALE ITEM ACTIONS
// ===========================

// ADD SALE ITEM
export const addSaleItem = async (
  saleIdInput: string,
  itemInput: SaleItemInput
): Promise<ActionResponse<Serialized<SaleItem> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(saleIdInput);
    const parsed = saleItemInputSchema.safeParse(itemInput);
    if (!id.success || !parsed.success) {
      return invalidInput('Cantidad debe ser mayor a 0 y precio no puede ser negativo');
    }
    const saleId = id.data;
    const itemData = parsed.data;
    const userId = actor.userId;

    // Verificar que la venta existe en la organización y no está eliminada
    const sale = await prisma.sale.findFirst({
      where: { id: saleId, organizationId: actor.organizationId, isDeleted: false },
    });

    if (!sale) {
      return { status: 404, message: 'Venta no encontrada', data: null };
    }

    if (sale.status === 'CANCELLED') {
      return {
        status: 400,
        message: 'No se pueden agregar items a una venta cancelada',
        data: null,
      };
    }

    // Verificar producto y stock
    const product = await prisma.product.findFirst({
      where: {
        id: itemData.productId,
        organizationId: sale.organizationId,
        isDeleted: false,
        isActive: true,
      },
    });

    if (!product) {
      return {
        status: 400,
        message: 'Producto no encontrado o inactivo',
        data: null,
      };
    }

    if (product.currentStock < itemData.quantity) {
      return {
        status: 400,
        message: `Stock insuficiente. Disponible: ${product.currentStock}`,
        data: null,
      };
    }

    // Agregar item en transacción
    const newItem = await prisma.$transaction(async (tx) => {
      // Crear el item
      const item = await tx.saleItem.create({
        data: {
          productId: itemData.productId,
          unitMeasureId: itemData.unitMeasureId ?? null,
          quantity: itemData.quantity,
          unitPrice: itemData.unitPrice,
          saleId,
          subtotal: itemData.quantity * itemData.unitPrice,
        },
        include: saleItemInclude,
      });

      // Actualizar totales de la venta
      const saleItems = await tx.saleItem.findMany({
        where: { saleId, isDeleted: false },
      });

      const { subtotal, total } = calculateSaleTotals(
        saleItems.map((i) => ({
          quantity: i.quantity,
          unitPrice: i.unitPrice.toNumber(),
        }))
      );

      await tx.sale.update({
        where: { id: saleId },
        data: {
          subtotal,
          total,
          updatedAt: new Date(),
        },
      });

      // Actualizar stock
      await tx.product.update({
        where: { id: itemData.productId },
        data: {
          currentStock: {
            decrement: itemData.quantity,
          },
          updatedAt: new Date(),
        },
      });

      // Crear movimiento de stock
      await tx.stockMovement.create({
        data: {
          organizationId: sale.organizationId,
          productId: itemData.productId,
          userId,
          storeId: sale.storeId,
          type: 'OUT',
          quantity: itemData.quantity,
          previousStock: 0,
          newStock: 0,
          reason: `Agregado a venta ${sale.saleNumber}`,
          reference: saleId,
        },
      });

      return item;
    });

    return {
      status: 201,
      message: 'Item agregado a la venta exitosamente',
      data: serializeDecimals(newItem),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error adding sale item:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// UPDATE SALE ITEM
export const updateSaleItem = async (
  itemIdInput: string,
  updateInput: UpdateSaleItemInput
): Promise<ActionResponse<Serialized<SaleItem> | null>> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(itemIdInput);
    if (!id.success) return invalidInput('ID del item es requerido');
    const parsed = updateSaleItemInputSchema.safeParse(updateInput);
    if (!parsed.success) return invalidInput('Cantidad o precio inválidos');
    const itemId = id.data;
    const updateData = parsed.data;
    const userId = actor.userId;

    const existingItem = await prisma.saleItem.findFirst({
      where: {
        id: itemId,
        isDeleted: false,
        sale: { organizationId: actor.organizationId, isDeleted: false },
      },
      include: { sale: true },
    });

    if (!existingItem) {
      return { status: 404, message: 'Item no encontrado', data: null };
    }

    if (existingItem.sale.status === 'CANCELLED') {
      return {
        status: 400,
        message: 'No se pueden modificar items de una venta cancelada',
        data: null,
      };
    }

    if (updateData.quantity !== undefined && updateData.quantity <= 0) {
      return {
        status: 400,
        message: 'La cantidad debe ser mayor a 0',
        data: null,
      };
    }

    if (updateData.unitPrice !== undefined && updateData.unitPrice < 0) {
      return {
        status: 400,
        message: 'El precio no puede ser negativo',
        data: null,
      };
    }

    // Actualizar item en transacción
    const updatedItem = await prisma.$transaction(async (tx) => {
      const newQuantity = updateData.quantity ?? existingItem.quantity;
      const newUnitPrice =
        updateData.unitPrice ?? existingItem.unitPrice.toNumber();
      const quantityDiff = newQuantity - existingItem.quantity;

      // Verificar stock si se aumenta la cantidad
      if (quantityDiff > 0) {
        const product = await tx.product.findUnique({
          where: { id: existingItem.productId },
        });

        if (!product || product.currentStock < quantityDiff) {
          throw new Error('Stock insuficiente para el incremento solicitado');
        }
      }

      // Actualizar el item
      const item = await tx.saleItem.update({
        where: { id: itemId },
        data: {
          quantity: newQuantity,
          unitPrice: newUnitPrice,
          subtotal: newQuantity * newUnitPrice,
          updatedAt: new Date(),
        },
        include: saleItemInclude,
      });

      // Actualizar stock si cambió la cantidad
      if (quantityDiff !== 0) {
        await tx.product.update({
          where: { id: existingItem.productId },
          data: {
            currentStock: {
              decrement: quantityDiff,
            },
            updatedAt: new Date(),
          },
        });

        // Crear movimiento de stock
        await tx.stockMovement.create({
          data: {
            organizationId: existingItem.sale.organizationId,
            productId: existingItem.productId,
            userId,
            storeId: existingItem.sale.storeId,
            type: quantityDiff > 0 ? 'OUT' : 'IN',
            quantity: Math.abs(quantityDiff),
            previousStock: 0,
            newStock: 0,
            reason: `Ajuste en venta ${existingItem.sale.saleNumber}`,
            reference: existingItem.saleId,
          },
        });
      }

      // Recalcular totales de la venta
      const saleItems = await tx.saleItem.findMany({
        where: { saleId: existingItem.saleId, isDeleted: false },
      });

      const { subtotal, total } = calculateSaleTotals(
        saleItems.map((i) => ({
          quantity: i.quantity,
          unitPrice: i.unitPrice.toNumber(),
        }))
      );

      await tx.sale.update({
        where: { id: existingItem.saleId },
        data: {
          subtotal,
          total,
          updatedAt: new Date(),
        },
      });

      return item;
    });

    return {
      status: 200,
      message: 'Item actualizado exitosamente',
      data: serializeDecimals(updatedItem),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error updating sale item:', error);

    if (error instanceof Error && error.message.startsWith('Stock insuficiente')) {
      return {
        status: 400,
        message: error.message,
        data: null,
      };
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// DELETE SALE ITEM
export const deleteSaleItem = async (itemIdInput: string): Promise<ActionResponse> => {
  try {
    const actor = await requireActor(ADMIN_ONLY);
    const id = idSchema.safeParse(itemIdInput);
    if (!id.success) return invalidInput('ID del item es requerido');
    const itemId = id.data;
    const userId = actor.userId;

    const existingItem = await prisma.saleItem.findFirst({
      where: {
        id: itemId,
        isDeleted: false,
        sale: { organizationId: actor.organizationId, isDeleted: false },
      },
      include: { sale: true },
    });

    if (!existingItem) {
      return { status: 404, message: 'Item no encontrado', data: null };
    }

    if (existingItem.sale.status === 'CANCELLED') {
      return {
        status: 400,
        message: 'No se pueden eliminar items de una venta cancelada',
        data: null,
      };
    }

    // Verificar que no sea el último item de la venta
    const itemCount = await prisma.saleItem.count({
      where: { saleId: existingItem.saleId, isDeleted: false },
    });

    if (itemCount <= 1) {
      return {
        status: 400,
        message: 'No se puede eliminar el último item de la venta',
        data: null,
      };
    }

    // Eliminar item y restaurar stock en transacción
    await prisma.$transaction(async (tx) => {
      // Soft delete del item
      await tx.saleItem.update({
        where: { id: itemId },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Restaurar stock
      await tx.product.update({
        where: { id: existingItem.productId },
        data: {
          currentStock: {
            increment: existingItem.quantity,
          },
          updatedAt: new Date(),
        },
      });

      // Crear movimiento de stock
      await tx.stockMovement.create({
        data: {
          organizationId: existingItem.sale.organizationId,
          productId: existingItem.productId,
          userId,
          storeId: existingItem.sale.storeId,
          type: 'IN',
          quantity: existingItem.quantity,
          previousStock: 0,
          newStock: 0,
          reason: `Eliminación de item de venta ${existingItem.sale.saleNumber}`,
          reference: existingItem.saleId,
        },
      });

      // Recalcular totales de la venta
      const remainingSaleItems = await tx.saleItem.findMany({
        where: { saleId: existingItem.saleId, isDeleted: false },
      });

      const { subtotal, total } = calculateSaleTotals(
        remainingSaleItems.map((i) => ({
          quantity: i.quantity,
          unitPrice: i.unitPrice.toNumber(),
        }))
      );

      await tx.sale.update({
        where: { id: existingItem.saleId },
        data: {
          subtotal,
          total,
          updatedAt: new Date(),
        },
      });
    });

    return {
      status: 200,
      message: 'Item eliminado exitosamente',
      data: null,
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error deleting sale item:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};

// GET SALE ITEMS BY SALE ID
export const getSaleItemsBySaleId = async (
  saleIdInput: string
): Promise<ActionResponse<Serialized<SaleItem>[] | null>> => {
  try {
    const actor = await requireActor();
    const id = idSchema.safeParse(saleIdInput);
    if (!id.success) return invalidInput('ID de venta es requerido');

    const items = await prisma.saleItem.findMany({
      where: {
        saleId: id.data,
        isDeleted: false,
        sale: { organizationId: actor.organizationId, isDeleted: false },
      },
      include: saleItemInclude,
      orderBy: { createdAt: 'asc' },
    });

    return {
      status: 200,
      message: 'Items de venta obtenidos exitosamente',
      data: serializeDecimals(items),
    };
  } catch (error) {
    const denied = actorErrorResponse(error);
    if (denied) return denied;
    console.error('Error fetching sale items:', error);
    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};
