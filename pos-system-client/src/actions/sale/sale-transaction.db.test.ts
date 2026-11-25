import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PrismaClient } from '@/generated/prisma';
import type { Actor } from '@/lib/auth/actor';
import { cancelSaleForActor, createSaleForActor } from './sale-transaction';

/**
 * CC-POS-09: venta, consecutivo y stock contra PostgreSQL real (no mocks).
 * Corre en CI sobre la base efímera ya migrada y sembrada (`pnpm test:db`).
 * Crea su propia tienda y productos en la organización demo y los borra al final.
 */
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
if (process.env.NODE_ENV !== 'test' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
  throw new Error('test:db solo corre con NODE_ENV=test contra una base local descartable');
}

const db = new PrismaClient();
const TAG = `CI-17-${Date.now()}`;
let actor: Actor;
let storeId: string;
let cashId: string;
const productIds: string[] = [];

before(async () => {
  const org = await db.organization.findFirstOrThrow({ where: { name: 'Pos Demo Org', isDeleted: false } });
  const admin = await db.user.findFirstOrThrow({ where: { email: 'admin@pos.test', isDeleted: false } });
  actor = { userId: admin.id, organizationId: org.id, role: 'ADMIN', storeId: null };
  const store = await db.store.create({
    data: { organizationId: org.id, name: TAG, address: 'Prueba CI', saleNumberPrefix: 'T17' },
  });
  storeId = store.id;
  const cash = await db.paymentMethod.findFirstOrThrow({ where: { organizationId: org.id, name: 'Efectivo' } });
  cashId = cash.id;
});

after(async () => {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS cc17_fail ON sale_payments');
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS cc17_fail ON stock_movements');
  await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS cc17_fail()');
  await db.stockMovement.deleteMany({ where: { productId: { in: productIds } } });
  await db.salePayment.deleteMany({ where: { sale: { storeId } } });
  await db.saleItem.deleteMany({ where: { sale: { storeId } } });
  await db.sale.deleteMany({ where: { storeId } });
  await db.product.deleteMany({ where: { id: { in: productIds } } });
  await db.store.deleteMany({ where: { id: storeId } });
  await db.$disconnect();
});

const newProduct = async (stock: number, salePrice = 1000) => {
  const product = await db.product.create({
    data: {
      organizationId: actor.organizationId,
      name: `${TAG}-${productIds.length}`,
      costPrice: 500,
      salePrice,
      currentStock: stock,
    },
  });
  productIds.push(product.id);
  return product.id;
};

const stockOf = async (productId: string) =>
  (await db.product.findUniqueOrThrow({ where: { id: productId } })).currentStock;

/** Hace fallar, dentro de PostgreSQL, las filas de `table` que cumplan `when`. */
const failOn = async (table: 'sale_payments' | 'stock_movements', when: string) => {
  await db.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION cc17_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CC-POS-09 fallo inyectado'; END $$`
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER cc17_fail BEFORE INSERT ON ${table} FOR EACH ROW WHEN (${when}) EXECUTE FUNCTION cc17_fail()`
  );
};
const stopFailing = (table: 'sale_payments' | 'stock_movements') =>
  db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS cc17_fail ON ${table}`);

const sellOne = (productId: string) =>
  createSaleForActor(db, actor, {
    saleData: { storeId, status: 'PAID' },
    saleItems: [{ productId, quantity: 1, unitPrice: 1000 }],
  });

test('con stock 3 y 8 ventas simultáneas de 1 unidad se confirman 3, el stock queda en 0 y los consecutivos no se repiten', async () => {
  const productId = await newProduct(3);

  const results = await Promise.all(Array.from({ length: 8 }, () => sellOne(productId)));

  const created = results.filter((r) => r.status === 201);
  assert.equal(created.length, 3, results.map((r) => `${r.status} ${r.message}`).join(' | '));
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.status === 400));
  assert.equal(await stockOf(productId), 0);
  const sales = await db.sale.findMany({ where: { storeId, saleItems: { some: { productId } } } });
  assert.deepEqual(sales.map((s) => s.saleNumber).sort(), ['T17-000001', 'T17-000002', 'T17-000003']);
  const movements = await db.stockMovement.findMany({ where: { productId, type: 'OUT' } });
  assert.equal(movements.length, 3);
  assert.deepEqual(movements.map((m) => m.newStock).sort(), [0, 1, 2]);
  assert.equal((await db.store.findUniqueOrThrow({ where: { id: storeId } })).lastSaleNumber, 3);
});

test('si falla un paso de la venta no queda venta, movimiento de stock ni consecutivo consumido', async () => {
  const productId = await newProduct(5);
  const counterBefore = (await db.store.findUniqueOrThrow({ where: { id: storeId } })).lastSaleNumber;
  const salesBefore = await db.sale.count({ where: { storeId } });
  await failOn('sale_payments', `NEW.notes = '${TAG}-falla'`);
  try {
    const result = await createSaleForActor(db, actor, {
      saleData: { storeId, status: 'PAID' },
      saleItems: [{ productId, quantity: 2, unitPrice: 1000 }],
      salePayments: [{ paymentMethodId: cashId, amount: 2000, notes: `${TAG}-falla` }],
    });
    assert.notEqual(result.status, 201);
  } finally {
    await stopFailing('sale_payments');
  }

  assert.equal(await stockOf(productId), 5);
  assert.equal(await db.stockMovement.count({ where: { productId } }), 0);
  assert.equal(await db.saleItem.count({ where: { productId } }), 0);
  assert.equal(await db.sale.count({ where: { storeId } }), salesBefore, 'sin fila en sales');
  assert.equal((await db.store.findUniqueOrThrow({ where: { id: storeId } })).lastSaleNumber, counterBefore);
});

test('anular una venta devuelve el stock en la misma transacción', async () => {
  const productId = await newProduct(4);
  const sale = await createSaleForActor(db, actor, {
    saleData: { storeId, status: 'PAID' },
    saleItems: [{ productId, quantity: 3, unitPrice: 1000 }],
  });
  assert.equal(sale.status, 201, sale.message);
  const saleId = sale.data!.id;
  assert.equal(await stockOf(productId), 1);

  // Si la devolución del stock falla, la venta no queda anulada.
  await failOn('stock_movements', `NEW.product_id = '${productId}'::uuid AND NEW.type = 'IN'`);
  try {
    const failed = await cancelSaleForActor(db, actor, saleId, 'prueba');
    assert.notEqual(failed.status, 200);
  } finally {
    await stopFailing('stock_movements');
  }
  assert.equal((await db.sale.findUniqueOrThrow({ where: { id: saleId } })).status, 'PAID');
  assert.equal(await stockOf(productId), 1);

  const cancelled = await cancelSaleForActor(db, actor, saleId, 'prueba');
  assert.equal(cancelled.status, 200, cancelled.message);
  assert.equal(cancelled.data!.status, 'CANCELLED');
  assert.equal(cancelled.data!.notes, '\nCANCELADO: prueba');
  assert.equal(await stockOf(productId), 4);
  const back = await db.stockMovement.findMany({ where: { productId, type: 'IN', reference: saleId } });
  assert.deepEqual(back.map((m) => [m.quantity, m.previousStock, m.newStock]), [[3, 1, 4]]);
});

/** CC-POS-10: vendedor de la tienda de prueba (el precio lo pone el servidor). */
const sellerActor = async (): Promise<Actor> => {
  const seller = await db.user.findFirstOrThrow({ where: { email: 'seller@pos.test', isDeleted: false } });
  return { userId: seller.id, organizationId: actor.organizationId, role: 'SELLER', storeId };
};

test('un vendedor que envía un precio distinto al del producto recibe error y no se guarda la venta', async () => {
  const productId = await newProduct(5);
  const salesBefore = await db.sale.count({ where: { storeId } });

  const result = await createSaleForActor(db, await sellerActor(), {
    saleData: { storeId, status: 'PAID' },
    saleItems: [{ productId, quantity: 1, unitPrice: 1 }],
  });

  assert.equal(result.status, 403, result.message);
  assert.equal(await db.sale.count({ where: { storeId } }), salesBefore);
  assert.equal(await stockOf(productId), 5);
});

test('la venta de un vendedor guarda el precio del producto aunque no lo envíe', async () => {
  const productId = await newProduct(5);

  const result = await createSaleForActor(db, await sellerActor(), {
    saleData: { storeId, status: 'PAID' },
    saleItems: [{ productId, quantity: 2 }],
  });

  assert.equal(result.status, 201, result.message);
  const saved = await db.sale.findUniqueOrThrow({ where: { id: result.data!.id }, include: { saleItems: true } });
  assert.equal(saved.saleItems[0].unitPrice.toString(), '1000');
  assert.equal(saved.saleItems[0].subtotal.toString(), '2000');
  assert.equal(saved.total.toString(), '2000');
});

test('3 × 33,33 da un total de 99,99 igual a la suma de la base y exige pagar exacto', async () => {
  const productId = await newProduct(10, 33.33);
  const sell = (amount: number) =>
    createSaleForActor(db, actor, {
      saleData: { storeId, status: 'PAID' },
      saleItems: [{ productId, quantity: 3 }],
      salePayments: [{ paymentMethodId: cashId, amount }],
    });

  const short = await sell(99.98);
  assert.equal(short.status, 400, 'un centavo de menos no cuadra');

  const result = await sell(99.99);
  assert.equal(result.status, 201, result.message);
  const [row] = await db.$queryRaw<{ total: string; items: string }[]>`
    SELECT s.total::text AS total, SUM(i.subtotal)::text AS items
    FROM sales s JOIN sale_items i ON i.sale_id = s.id
    WHERE s.id = ${result.data!.id}::uuid GROUP BY s.total`;
  assert.deepEqual(row, { total: '99.99', items: '99.99' });
});
