import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@/generated/prisma';
import { recordStockMovement, StockMovementError } from './record-stock-movement';

/**
 * CC-POS-09: movimientos de stock contra PostgreSQL real (`pnpm test:db`).
 * Crea sus productos en la organización demo y los borra al final.
 */
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
if (process.env.NODE_ENV !== 'test' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
  throw new Error('test:db solo corre con NODE_ENV=test contra una base local descartable');
}

const db = new PrismaClient();
const TAG = `CI-17-SM-${Date.now()}`;
let organizationId: string;
let userId: string;
const productIds: string[] = [];

before(async () => {
  organizationId = (await db.organization.findFirstOrThrow({ where: { name: 'Pos Demo Org', isDeleted: false } })).id;
  userId = (await db.user.findFirstOrThrow({ where: { email: 'admin@pos.test', isDeleted: false } })).id;
});

after(async () => {
  await db.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
  await db.product.deleteMany({ where: { id: { in: productIds } } });
  await db.$disconnect();
});

const newProduct = async (stock: number) => {
  const product = await db.product.create({
    data: { organizationId, name: `${TAG}-${productIds.length}`, costPrice: 500, salePrice: 1000, currentStock: stock },
  });
  productIds.push(product.id);
  return product.id;
};

const move = (productId: string, type: 'IN' | 'OUT', quantity: number) =>
  db.$transaction((tx) =>
    recordStockMovement(tx, organizationId, userId, {
      productId, storeId: null, type, quantity, reason: TAG, reference: null,
    })
  );

test('entradas simultáneas (recepción de compras) suman todas sin pisarse', async () => {
  const productId = await newProduct(1);

  await Promise.all(Array.from({ length: 5 }, () => move(productId, 'IN', 2)));

  assert.equal((await db.product.findUniqueOrThrow({ where: { id: productId } })).currentStock, 11);
  const movements = await db.stockMovement.findMany({ where: { productId }, orderBy: { newStock: 'asc' } });
  assert.deepEqual(movements.map((m) => [m.previousStock, m.newStock]), [[1, 3], [3, 5], [5, 7], [7, 9], [9, 11]]);
});

test('una salida mayor que el stock se rechaza sin tocar el producto ni dejar movimiento', async () => {
  const productId = await newProduct(2);

  await assert.rejects(move(productId, 'OUT', 3), (error) =>
    error instanceof StockMovementError && /Disponible: 2, Requerido: 3/.test(error.message)
  );

  assert.equal((await db.product.findUniqueOrThrow({ where: { id: productId } })).currentStock, 2);
  assert.equal(await db.stockMovement.count({ where: { productId } }), 0);
});
