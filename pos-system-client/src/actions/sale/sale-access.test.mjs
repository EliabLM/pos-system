import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { loadWithMocks } from '../../../test/load-with-mocks.mjs';

// Decimal real de Prisma: los totales de venta se calculan con él (CC-POS-10).
const { Decimal } = createRequire(import.meta.url)('../../generated/prisma/runtime/library.js');
globalThis.__Decimal = Decimal;

// Contrato de ventas (sale, sale-item, sale-payment): identidad y tenant salen
// del actor de sesión; IDs de organización/usuario del cliente se ignoran.
const ID = {
  saleB: '00000000-0000-4000-8000-0000000000b1',
  itemB: '00000000-0000-4000-8000-0000000000b2',
  paymentB: '00000000-0000-4000-8000-0000000000b3',
  storeA: '00000000-0000-4000-8000-0000000000a1',
  storeB: '00000000-0000-4000-8000-0000000000b4',
  productA: '00000000-0000-4000-8000-0000000000a2',
  methodA: '00000000-0000-4000-8000-0000000000a3',
};
const dec = (n) => new Decimal(n);
const ADMIN_A = { userId: 'admin-a', organizationId: 'org-a', role: 'ADMIN', storeId: null };
const SELLER_A = { userId: 'seller-a', organizationId: 'org-a', role: 'SELLER', storeId: ID.storeA };
const ADMIN_B = { userId: 'admin-b', organizationId: 'org-b', role: 'ADMIN', storeId: null };

const state = { actor: null, calls: [], writes: [], stock: [] };
globalThis.__saleTest = state;

const saleB = () => ({
  id: ID.saleB, organizationId: 'org-b', storeId: ID.storeB, saleNumber: 'B-000001', status: 'PENDING',
  notes: null, paidDate: null, total: dec(10), subtotal: dec(10),
  saleItems: [{ id: ID.itemB, productId: 'product-b', quantity: 1 }],
  salePayments: [],
});
const itemB = () => ({ id: ID.itemB, saleId: ID.saleB, productId: 'product-b', quantity: 1, unitPrice: dec(10), sale: saleB() });
const paymentB = () => ({ id: ID.paymentB, saleId: ID.saleB, amount: dec(5), sale: saleB() });

/** org visible a una consulta: la de `where.organizationId` o `where.sale.organizationId`. */
const scopedOrg = (where = {}) => where.organizationId ?? where.sale?.organizationId;
const visibleToB = (where) => scopedOrg(where) === undefined || scopedOrg(where) === 'org-b';

const read = (model, method, handler) => async (args = {}) => {
  state.calls.push({ model, method, where: args.where, include: args.include });
  return handler(args);
};
const write = (model, method, result = () => ({})) => async (args = {}) => {
  state.writes.push({ model, method, data: args.data, where: args.where });
  return result(args);
};

const prisma = {
  sale: {
    findFirst: read('sale', 'findFirst', ({ where }) => (where.id === ID.saleB && visibleToB(where) ? saleB() : null)),
    findMany: read('sale', 'findMany', ({ where }) => (visibleToB(where) ? [saleB()] : [])),
    findUnique: read('sale', 'findUnique', ({ where }) => ({ ...saleB(), id: where.id })),
    count: read('sale', 'count', () => 0),
    aggregate: read('sale', 'aggregate', () => ({ _count: { id: 0 }, _sum: { total: null }, _avg: { total: null } })),
    groupBy: read('sale', 'groupBy', () => []),
    create: write('sale', 'create', ({ data }) => ({ id: 'new-sale', saleNumber: 'A-000001', ...data })),
    update: write('sale', 'update'),
  },
  saleItem: {
    findFirst: read('saleItem', 'findFirst', ({ where }) => (where.id === ID.itemB && visibleToB(where) ? itemB() : null)),
    findMany: read('saleItem', 'findMany', ({ where }) => (visibleToB(where) ? [itemB()] : [])),
    count: read('saleItem', 'count', () => 2),
    groupBy: read('saleItem', 'groupBy', () => []),
    create: write('saleItem', 'create'),
    update: write('saleItem', 'update'),
  },
  salePayment: {
    findFirst: read('salePayment', 'findFirst', ({ where }) => (where.id === ID.paymentB && visibleToB(where) ? paymentB() : null)),
    findMany: read('salePayment', 'findMany', ({ where }) => (visibleToB(where) ? [paymentB()] : [])),
    create: write('salePayment', 'create'),
    update: write('salePayment', 'update'),
  },
  store: {
    findFirst: read('store', 'findFirst', ({ where }) => (where.id === ID.storeA && where.organizationId === 'org-a' ? { id: ID.storeA } : null)),
    findUnique: read('store', 'findUnique', () => ({ id: ID.storeA, lastSaleNumber: 0, saleNumberPrefix: 'A' })),
    findMany: read('store', 'findMany', () => []),
    update: write('store', 'update', () => ({ saleNumberPrefix: 'A', lastSaleNumber: 1 })),
  },
  customer: { findFirst: read('customer', 'findFirst', () => null) },
  product: {
    findMany: read('product', 'findMany', ({ where }) => (where.organizationId === 'org-a' ? [{ id: ID.productA, name: 'Producto A', currentStock: 10, salePrice: new Decimal(5) }] : [])),
    findFirst: read('product', 'findFirst', () => null),
    findUnique: read('product', 'findUnique', () => null),
    update: write('product', 'update'),
  },
  paymentMethod: {
    findMany: read('paymentMethod', 'findMany', ({ where }) => (where.organizationId === 'org-a' ? [{ id: ID.methodA }] : [])),
    findFirst: read('paymentMethod', 'findFirst', () => null),
  },
  stockMovement: { create: write('stockMovement', 'create') },
  $transaction: async (fn) => fn(prisma),
};
globalThis.__salePrisma = prisma;

const mocks = {
  '@/generated/prisma': `
    export const Prisma = { PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {}, Decimal: globalThis.__Decimal };
    export const MembershipRole = { ADMIN: 'ADMIN', SELLER: 'SELLER' };
    export const SaleStatus = { PAID: 'PAID', PENDING: 'PENDING', OVERDUE: 'OVERDUE', CANCELLED: 'CANCELLED' };`,
  '@/lib/auth/actor': `
    export class ActorError extends Error { constructor(code) { super(code); this.code = code; this.status = code === 'UNAUTHENTICATED' ? 401 : 403; } }
    export const getActor = async () => {
      const actor = globalThis.__saleTest.actor;
      if (!actor) throw new ActorError('UNAUTHENTICATED');
      if (actor === 'NO_MEMBERSHIP') throw new ActorError('FORBIDDEN');
      return actor;
    };
    export const requireActor = async (options = {}) => {
      const actor = await getActor();
      if (options.roles && !options.roles.includes(actor.role)) throw new ActorError('FORBIDDEN');
      return actor;
    };
    export const actorErrorResponse = (error) => error instanceof ActorError ? { status: error.status, message: error.message, data: null } : null;`,
  '../utils': 'export const prisma = globalThis.__salePrisma; export const serializeDecimals = (value) => value;',
  '../stock-movement/record-stock-movement': `
    export class StockMovementError extends Error {}
    export const recordStockMovement = async (tx, orgId, userId, data) => { globalThis.__saleTest.stock.push({ orgId, userId, data }); return {}; };`,
};

const sale = await loadWithMocks('src/actions/sale/sale.actions.ts', mocks);
const saleItem = await loadWithMocks('src/actions/sale-item/sale-item.actions.ts', mocks);
const salePayment = await loadWithMocks('src/actions/sale-payment/sale-payment.actions.ts', mocks);

function reset(actor) {
  state.actor = actor;
  state.calls = [];
  state.writes = [];
  state.stock = [];
}

// Payload hostil: IDs ajenos mezclados en todos los argumentos posibles.
const foreign = { organizationId: 'org-b', userId: 'admin-b', orgId: 'org-b' };

/** Acciones sobre un recurso de la organización B, con su resultado esperado para un admin de A. */
const resourceActions = {
  'sale.getSaleById': { run: () => sale.getSaleById(ID.saleB), expectA: 404 },
  'sale.getSaleBySaleNumber': { run: () => sale.getSaleBySaleNumber(ID.storeB, 'B-000001'), expectA: 404 },
  'sale.updateSale': { run: () => sale.updateSale(ID.saleB, { notes: 'x', ...foreign }), expectA: 404, adminOnly: true },
  'sale.cancelSale': { run: () => sale.cancelSale(ID.saleB, 'x'), expectA: 404, adminOnly: true },
  'sale.softDeleteSale': { run: () => sale.softDeleteSale(ID.saleB), expectA: 404, adminOnly: true },
  'saleItem.addSaleItem': { run: () => saleItem.addSaleItem(ID.saleB, { productId: ID.productA, quantity: 1, unitPrice: 1, ...foreign }), expectA: 404, adminOnly: true },
  'saleItem.updateSaleItem': { run: () => saleItem.updateSaleItem(ID.itemB, { quantity: 2 }), expectA: 404, adminOnly: true },
  'saleItem.deleteSaleItem': { run: () => saleItem.deleteSaleItem(ID.itemB), expectA: 404, adminOnly: true },
  'saleItem.getSaleItemsBySaleId': { run: () => saleItem.getSaleItemsBySaleId(ID.saleB), expectA: 200, emptyList: true },
  'salePayment.addSalePayment': { run: () => salePayment.addSalePayment(ID.saleB, { paymentMethodId: ID.methodA, amount: 1, ...foreign }), expectA: 404, adminOnly: true },
  'salePayment.updateSalePayment': { run: () => salePayment.updateSalePayment(ID.paymentB, { amount: 1 }), expectA: 404, adminOnly: true },
  'salePayment.deleteSalePayment': { run: () => salePayment.deleteSalePayment(ID.paymentB), expectA: 404, adminOnly: true },
  'salePayment.getSalePaymentsBySaleId': { run: () => salePayment.getSalePaymentsBySaleId(ID.saleB), expectA: 200, emptyList: true },
};

const scopedModels = new Set(['sale', 'saleItem', 'salePayment']);

for (const [name, { run, expectA, adminOnly, emptyList }] of Object.entries(resourceActions)) {
  test(`${name}: sin sesión 401, sin membresía 403, otra organización ${expectA === 404 ? '404' : 'vacío'}, sin escrituras`, async () => {
    reset(null);
    let result = await run();
    assert.equal(result.status, 401);
    assert.equal(result.data, null);
    assert.equal(state.calls.length, 0, 'no consulta la BD sin sesión');

    reset('NO_MEMBERSHIP');
    result = await run();
    assert.equal(result.status, 403);
    assert.equal(state.calls.length, 0);

    if (adminOnly) {
      reset(SELLER_A);
      result = await run();
      assert.equal(result.status, 403);
      assert.equal(state.calls.length, 0);
    }

    reset(ADMIN_A);
    result = await run();
    assert.equal(result.status, expectA);
    if (emptyList) assert.deepEqual(result.data, []);
    else assert.equal(result.data, null);
    assert.deepEqual(state.writes, [], 'sin escrituras sobre la organización B');
    assert.deepEqual(state.stock, []);
    for (const call of state.calls.filter((c) => scopedModels.has(c.model))) {
      assert.equal(scopedOrg(call.where), 'org-a', `${call.model}.${call.method} filtra por la organización del actor`);
    }
  });
}

test('control positivo: el admin de B sí lee su venta (el doble de BD no es trivial)', async () => {
  reset(ADMIN_B);
  const result = await sale.getSaleById(ID.saleB);
  assert.equal(result.status, 200);
  assert.equal(result.data.id, ID.saleB);
});

test('createSale: sin sesión 401 y sin escrituras', async () => {
  reset(null);
  const result = await sale.createSale({ saleData: { storeId: ID.storeA }, saleItems: [{ productId: ID.productA, quantity: 1, unitPrice: 5 }] });
  assert.equal(result.status, 401);
  assert.equal(state.calls.length, 0);
  assert.deepEqual(state.writes, []);
});

test('createSale: ignora organizationId/userId/totales enviados por el cliente', async () => {
  reset(SELLER_A);
  const result = await sale.createSale({
    ...foreign,
    saleData: { storeId: ID.storeA, status: 'PAID', ...foreign, subtotal: 1, total: 1, saleNumber: 'X' },
    saleItems: [{ productId: ID.productA, quantity: 2, unitPrice: 5, subtotal: 1, saleId: 'other', ...foreign }],
    salePayments: [{ paymentMethodId: ID.methodA, amount: 10, saleId: 'other', ...foreign }],
  });
  assert.equal(result.status, 201, result.message);
  const created = state.writes.find((w) => w.model === 'sale' && w.method === 'create').data;
  assert.equal(created.organizationId, 'org-a');
  assert.equal(created.userId, 'seller-a');
  assert.equal(String(created.total), '10');
  assert.equal(String(created.subtotal), '10');
  assert.equal(created.saleNumber, 'A-000001', 'consecutivo del contador de la tienda, no del cliente');
  const item = state.writes.find((w) => w.model === 'saleItem').data;
  assert.equal(item.saleId, 'new-sale');
  assert.equal(String(item.subtotal), '10');
  assert.equal(item.organizationId, undefined);
  const payment = state.writes.find((w) => w.model === 'salePayment').data;
  assert.equal(payment.saleId, 'new-sale');
  assert.equal(payment.userId, undefined);
  assert.deepEqual(state.stock.map((s) => [s.orgId, s.userId]), [['org-a', 'seller-a']]);
  for (const call of state.calls.filter((c) => ['store', 'product', 'paymentMethod'].includes(c.model) && c.method !== 'findUnique')) {
    assert.equal(call.where.organizationId, 'org-a');
  }
});

test('createSale: seller con tienda asignada no vende en otra tienda de su organización', async () => {
  reset(SELLER_A);
  const otherStoreA = '00000000-0000-4000-8000-0000000000a9';
  const result = await sale.createSale({
    saleData: { storeId: otherStoreA },
    saleItems: [{ productId: ID.productA, quantity: 1, unitPrice: 5 }],
  });
  assert.equal(result.status, 403);
  assert.deepEqual(state.writes, []);
  assert.deepEqual(state.stock, []);
});

test('respuestas de ventas: el vendedor incluido solo expone id, nombre y email', async () => {
  reset(ADMIN_B);
  await sale.getSaleById(ID.saleB);
  await sale.getSales();
  await sale.getPendingSales();
  const includes = state.calls.filter((c) => c.model === 'sale' && c.include).map((c) => c.include);
  assert.ok(includes.length >= 3);
  for (const include of includes) {
    assert.deepEqual(include.user, { select: { id: true, name: true, email: true } });
  }
});

test('createSale: tienda de otra organización se rechaza sin escrituras', async () => {
  reset(ADMIN_A);
  const result = await sale.createSale({
    saleData: { storeId: ID.storeB },
    saleItems: [{ productId: ID.productA, quantity: 1, unitPrice: 5 }],
  });
  assert.equal(result.status, 400);
  assert.deepEqual(state.writes, []);
  assert.deepEqual(state.stock, []);
});

test('createSale: entrada inválida (cantidad, monto negativo) es 400 sin escrituras', async () => {
  reset(ADMIN_A);
  for (const input of [
    { saleData: { storeId: ID.storeA }, saleItems: [] },
    { saleData: { storeId: ID.storeA }, saleItems: [{ productId: ID.productA, quantity: 0, unitPrice: 5 }] },
    { saleData: { storeId: ID.storeA }, saleItems: [{ productId: ID.productA, quantity: 1, unitPrice: -1 }] },
    { saleData: { storeId: ID.storeA }, saleItems: [{ productId: ID.productA, quantity: 1, unitPrice: 5 }], salePayments: [{ paymentMethodId: ID.methodA, amount: -5 }] },
    { saleData: { storeId: 'not-an-id' }, saleItems: [{ productId: ID.productA, quantity: 1, unitPrice: 5 }] },
  ]) {
    const result = await sale.createSale(input);
    assert.equal(result.status, 400);
  }
  assert.deepEqual(state.writes, []);
});

test('getSales: organización del actor aunque el cliente mande otra; seller limitado a su tienda', async () => {
  reset(SELLER_A);
  const result = await sale.getSales({ storeId: ID.storeB, organizationId: 'org-b', orgId: 'org-b' }, true);
  assert.equal(result.status, 200);
  const where = state.calls.find((c) => c.model === 'sale' && c.method === 'findMany').where;
  assert.equal(where.organizationId, 'org-a');
  assert.equal(where.storeId, ID.storeA);
  assert.equal(where.isDeleted, false, 'seller no ve ventas eliminadas');

  reset(null);
  assert.equal((await sale.getSales()).status, 401);
});

test('analíticas, pendientes y vencidas: solo la organización del actor', async () => {
  for (const run of [() => sale.getSalesAnalytics(), () => sale.getPendingSales(), () => sale.getOverdueSales()]) {
    reset(null);
    assert.equal((await run()).status, 401);
    reset(ADMIN_A);
    assert.equal((await run()).status, 200);
    for (const call of state.calls.filter((c) => c.model === 'sale')) {
      assert.equal(call.where.organizationId, 'org-a');
    }
  }
});

test('updateSaleItem: el ADMIN cambia el precio y el subtotal y el total se guardan con 2 decimales', async () => {
  reset(ADMIN_B);
  const result = await saleItem.updateSaleItem(ID.itemB, { unitPrice: 33.333 });
  assert.equal(result.status, 200, result.message);
  const item = state.writes.find((w) => w.model === 'saleItem' && w.method === 'update').data;
  assert.equal(String(item.unitPrice), '33.33');
  assert.equal(String(item.subtotal), '33.33');
  const totals = state.writes.find((w) => w.model === 'sale' && w.method === 'update').data;
  assert.equal(String(totals.total), '10', 'el total sale de los ítems guardados');
});
