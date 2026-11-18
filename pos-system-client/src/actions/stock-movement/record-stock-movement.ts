import { Prisma, StockMovement, StockMovementType } from '@/generated/prisma';
import { ActionResponse } from '@/interfaces';
import { prisma } from '../utils';
import { stockMovementInclude } from './stock-movement.include';

export interface StockMovementRecord {
  productId: string;
  storeId: string | null;
  type: StockMovementType;
  quantity: number;
  reason: string | null;
  reference: string | null;
}

/**
 * Records a stock movement and updates the product stock. Internal helper, NOT
 * a server action: callers must have authorized the actor and must pass the
 * organization and user taken from it (`createStockMovement`, sales).
 */
export const recordStockMovement = async (
  organizationId: string,
  userId: string,
  movement: StockMovementRecord
): Promise<ActionResponse<StockMovement | null>> => {
  try {
    // Verificar que el producto existe y pertenece a la organización
    const product = await prisma.product.findFirst({
      where: { id: movement.productId, organizationId, isDeleted: false },
    });

    if (!product) {
      return {
        status: 400,
        message: 'El producto especificado no existe o no pertenece a la organización',
        data: null,
      };
    }

    if (!Number.isInteger(movement.quantity) || movement.quantity <= 0) {
      return { status: 400, message: 'La cantidad debe ser mayor a 0', data: null };
    }

    // Calcular nuevo stock basado en el tipo de movimiento
    let newStock: number;
    const currentStock = product.currentStock;

    switch (movement.type) {
      case 'IN':
        newStock = currentStock + movement.quantity;
        break;
      case 'OUT':
        newStock = currentStock - movement.quantity;
        if (newStock < 0) {
          return {
            status: 400,
            message: 'No hay suficiente stock disponible para este movimiento',
            data: null,
          };
        }
        break;
      case 'ADJUSTMENT':
        newStock = movement.quantity;
        break;
      default:
        return { status: 400, message: 'Tipo de movimiento de stock inválido', data: null };
    }

    // Crear el movimiento de stock y actualizar el producto en una transacción
    const result = await prisma.$transaction(async (tx) => {
      const newStockMovement = await tx.stockMovement.create({
        data: {
          productId: product.id,
          storeId: movement.storeId,
          type: movement.type,
          quantity: movement.quantity,
          reason: movement.reason,
          reference: movement.reference,
          userId,
          organizationId,
          previousStock: currentStock,
          newStock,
        },
        include: stockMovementInclude,
      });

      await tx.product.update({
        where: { id: product.id, organizationId },
        data: { currentStock: newStock, updatedAt: new Date() },
      });

      return newStockMovement;
    });

    return { status: 201, message: 'Movimiento de stock creado exitosamente', data: result };
  } catch (error) {
    console.error('Error creating stock movement:', error);

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return { status: 400, message: 'Una de las referencias especificadas no existe', data: null };
    }

    return { status: 500, message: 'Error interno del servidor', data: null };
  }
};
