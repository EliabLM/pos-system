import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_A, ADMIN_B, ID, SELLER_A, assertContract, foreign, load, prisma, reset, state } from '../../../test/catalog-harness.mjs';

// Contrato de compras (#13): solo administración; tenant e identidad salen del actor.
const purchase = await load('src/actions/purchase/purchase.actions.ts');
const emptyList = (data) => assert.deepEqual(data, []);
const item = () => ({ productId: ID.product, quantity: 2, unitPrice: 4 });

const actions = {
  createPurchase: {
    run: () => purchase.createPurchase({ supplierId: ID.supplier, ...foreign }, [item()]),
    expectA: 400, // el proveedor de B no existe para A
    adminOnly: true,
  },
  getPurchases: { run: () => purchase.getPurchases(), expectA: 200, adminOnly: true, empty: (data) => assert.deepEqual(data.purchases, []) },
  getPurchaseById: { run: () => purchase.getPurchaseById(ID.purchase), expectA: 404, adminOnly: true },
  getPurchaseByNumber: { run: () => purchase.getPurchaseByNumber('COMP-20261118-0001'), expectA: 404, adminOnly: true },
  updatePurchase: { run: () => purchase.updatePurchase(ID.purchase, { notes: 'x', ...foreign }), expectA: 404, adminOnly: true },
  receivePurchase: { run: () => purchase.receivePurchase(ID.purchase), expectA: 404, adminOnly: true },
  cancelPurchase: { run: () => purchase.cancelPurchase(ID.purchase, 'x'), expectA: 404, adminOnly: true },
  softDeletePurchase: { run: () => purchase.softDeletePurchase(ID.purchase), expectA: 404, adminOnly: true },
  getPurchasesAnalytics: { run: () => purchase.getPurchasesAnalytics(), expectA: 200, adminOnly: true },
  getPendingPurchases: { run: () => purchase.getPendingPurchases(), expectA: 200, adminOnly: true, empty: emptyList },
  getReceivedPurchases: { run: () => purchase.getReceivedPurchases(), expectA: 200, adminOnly: true, empty: emptyList },
};
for (const [name, spec] of Object.entries(actions)) assertContract(test, `purchase.${name}`, spec);

test('purchase.createPurchase: el proveedor de otra organización se rechaza con su mensaje', async () => {
  reset(ADMIN_A);
  const result = await purchase.createPurchase({ supplierId: ID.supplier }, [item()]);
  assert.equal(result.message, 'El proveedor especificado no existe');
});

test('purchase.createPurchase: estado, total, número y organización salen del servidor', async () => {
  reset(ADMIN_B);
  prisma.$queryRaw = async () => [{ ordinal: { toString: () => '0' } }];
  try {
    const result = await purchase.createPurchase(
      { supplierId: ID.supplier, status: 'RECEIVED', total: 1, purchaseNumber: 'X', ...foreign, organizationId: 'org-a' },
      [{ ...item(), subtotal: 1, purchaseId: 'otra' }],
    );
    assert.equal(result.status, 201);
  } finally {
    delete prisma.$queryRaw;
  }
  const created = state.writes.find((w) => w.model === 'purchase' && w.method === 'create').data;
  assert.equal(created.organizationId, 'org-b');
  assert.equal(created.status, 'PENDING');
  assert.equal(created.total, 8);
  assert.match(created.purchaseNumber, /^COMP-\d{8}-0001$/);
  for (const key of ['userId', 'orgId', 'id', 'isDeleted']) assert.ok(!(key in created), `${key} no llega a Prisma`);
  const line = state.writes.find((w) => w.model === 'purchaseItem' && w.method === 'create').data;
  assert.deepEqual(line, { productId: ID.product, quantity: 2, unitPrice: 4, subtotal: 8, purchaseId: 'new-purchase' });
});

test('purchase.createPurchase: sin ítems o con cantidad inválida 400 sin consultar', async () => {
  for (const items of [[], [{ ...item(), quantity: 0 }], [{ ...item(), unitPrice: -1 }]]) {
    reset(ADMIN_B);
    const result = await purchase.createPurchase({ supplierId: ID.supplier }, items);
    assert.equal(result.status, 400);
    assert.equal(state.calls.length, 0);
  }
});

test('purchase.receivePurchase: el admin de B recibe con su identidad y su organización', async () => {
  reset(ADMIN_B);
  const result = await purchase.receivePurchase(ID.purchase);
  assert.equal(result.status, 200);
  const movement = state.writes.find((w) => w.model === 'stockMovement' && w.method === 'create').data;
  assert.equal(movement.userId, 'admin-b');
  assert.equal(movement.organizationId, 'org-b');
  assert.equal(movement.newStock, 7);
  const stock = state.writes.find((w) => w.model === 'product' && w.method === 'update');
  assert.equal(stock.where.organizationId, 'org-b');
});

test('purchase.updatePurchase: solo cambia las notas', async () => {
  reset(ADMIN_B);
  const result = await purchase.updatePurchase(ID.purchase, { notes: 'ok', status: 'CANCELLED', organizationId: 'org-a' });
  assert.equal(result.status, 200);
  const update = state.writes.find((w) => w.model === 'purchase' && w.method === 'update');
  assert.deepEqual(Object.keys(update.data).sort(), ['notes', 'updatedAt']);
  assert.equal(update.where.organizationId, 'org-b');
});

test('purchase.getPurchases: el SELLER no lista compras', async () => {
  reset(SELLER_A);
  const result = await purchase.getPurchases();
  assert.equal(result.status, 403);
  assert.equal(state.calls.length, 0);
});
