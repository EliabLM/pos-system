import { Prisma, StockMovement, StockMovementType } from '@/generated/prisma';
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
 * Regla de inventario rota (producto ajeno, stock insuficiente, cantidad
 * inválida). Se lanza para que la transacción del llamador se revierta entera;
 * el llamador la convierte en una respuesta 400 con `message`.
 */
export class StockMovementError extends Error {
  readonly status = 400;
}

const productNotFound = () =>
  new StockMovementError('El producto especificado no existe o no pertenece a la organización');

/**
 * Registra un movimiento de stock y actualiza el producto dentro de la
 * transacción `tx` del llamador. Helper interno, NO server action: el
 * llamador ya autorizó al actor y pasa su organización y usuario.
 *
 * IN y OUT cambian el stock de forma relativa en un solo UPDATE (OUT solo si
 * alcanza), así dos cajas que venden a la vez no pisan el valor de la otra.
 * Lanza `StockMovementError` si una regla falla; nunca deja escrituras a medias
 * porque todo vive en `tx`.
 */
export const recordStockMovement = async (
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
  movement: StockMovementRecord
): Promise<StockMovement> => {
  if (!Number.isInteger(movement.quantity) || movement.quantity <= 0) {
    throw new StockMovementError('La cantidad debe ser mayor a 0');
  }

  const where = { id: movement.productId, organizationId, isDeleted: false };
  let previousStock: number;
  let newStock: number;

  if (movement.type === 'ADJUSTMENT') {
    // Valor absoluto: se bloquea la fila para leer el stock anterior sin carreras.
    const locked = await tx.$queryRaw<{ current_stock: number }[]>`
      SELECT current_stock FROM products
      WHERE id = ${movement.productId}::uuid AND organization_id = ${organizationId}::uuid AND is_deleted = false
      FOR UPDATE`;
    if (locked.length === 0) throw productNotFound();
    previousStock = locked[0].current_stock;
    newStock = movement.quantity;
    await tx.product.update({ where, data: { currentStock: newStock } });
  } else if (movement.type === 'IN' || movement.type === 'OUT') {
    const delta = movement.type === 'IN' ? movement.quantity : -movement.quantity;
    const updated = await tx.product.updateMany({
      where: movement.type === 'OUT' ? { ...where, currentStock: { gte: movement.quantity } } : where,
      data: { currentStock: { increment: delta } },
    });
    if (updated.count === 0) {
      const product = await tx.product.findFirst({ where, select: { name: true, currentStock: true } });
      if (!product) throw productNotFound();
      throw new StockMovementError(
        `Stock insuficiente para ${product.name}. Disponible: ${product.currentStock}, Requerido: ${movement.quantity}`
      );
    }
    // La fila quedó bloqueada por el UPDATE: esta lectura ve nuestro valor.
    const product = await tx.product.findFirstOrThrow({ where, select: { currentStock: true } });
    newStock = product.currentStock;
    previousStock = newStock - delta;
  } else {
    throw new StockMovementError('Tipo de movimiento de stock inválido');
  }

  return tx.stockMovement.create({
    data: {
      productId: movement.productId,
      storeId: movement.storeId,
      type: movement.type,
      quantity: movement.quantity,
      reason: movement.reason,
      reference: movement.reference,
      userId,
      organizationId,
      previousStock,
      newStock,
    },
    include: stockMovementInclude,
  });
};
