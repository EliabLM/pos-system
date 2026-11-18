import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_A, ADMIN_B, ID, assertContract, assertScopedTo, foreign, load, reset, state } from '../../../test/catalog-harness.mjs';

// Contrato de inventario (#12): movimientos, resúmenes y analíticas son de
// administración (también las lecturas); tenant y usuario salen del actor.
const stock = await load('src/actions/stock-movement/stock-movement.actions.ts');

const actions = {
  createStockMovement: {
    run: () => stock.createStockMovement({ productId: ID.product, type: 'IN', quantity: 1, ...foreign }),
    expectA: 400,
    adminOnly: true,
  },
  getStockMovements: {
    run: () => stock.getStockMovements({ productId: ID.product }),
    expectA: 200,
    adminOnly: true,
    empty: (data) => assert.deepEqual(data, { movements: [], total: 0 }),
  },
  getStockMovementById: { run: () => stock.getStockMovementById(ID.stockMovement), expectA: 404, adminOnly: true },
  getStockMovementsByProductId: { run: () => stock.getStockMovementsByProductId(ID.product), expectA: 404, adminOnly: true },
  updateStockMovement: { run: () => stock.updateStockMovement(ID.stockMovement, { reason: 'x', ...foreign }), expectA: 404, adminOnly: true },
  getStockSummaryByProduct: { run: () => stock.getStockSummaryByProduct(ID.product), expectA: 404, adminOnly: true },
  deleteStockMovement: { run: () => stock.deleteStockMovement(ID.stockMovement), expectA: 404, adminOnly: true },
  getStockMovementsByDateRange: {
    run: () => stock.getStockMovementsByDateRange(new Date('2026-01-01'), new Date('2026-12-31')),
    expectA: 200,
    adminOnly: true,
    empty: (data) => assert.deepEqual(data, []),
  },
  getStockAnalytics: { run: () => stock.getStockAnalytics(), expectA: 200, adminOnly: true },
};
for (const [name, spec] of Object.entries(actions)) assertContract(test, `stockMovement.${name}`, spec);

test('createStockMovement: tienda de otra organización 400 sin escrituras', async () => {
  reset(ADMIN_B);
  const result = await stock.createStockMovement({ productId: ID.product, type: 'IN', quantity: 1, storeId: ID.storeA });
  assert.equal(result.status, 400);
  assert.deepEqual(state.writes, []);
});

test('createStockMovement: organización y usuario salen del actor, no del cliente', async () => {
  reset(ADMIN_B);
  const result = await stock.createStockMovement({
    productId: ID.product, type: 'IN', quantity: 2, reason: 'Compra', storeId: ID.storeB,
    organizationId: 'org-a', userId: 'admin-a', previousStock: 0, newStock: 999,
  });
  assert.equal(result.status, 201);
  const movement = state.writes.find((w) => w.model === 'stockMovement' && w.method === 'create').data;
  assert.equal(movement.organizationId, 'org-b');
  assert.equal(movement.userId, 'admin-b');
  assert.equal(movement.previousStock, 5);
  assert.equal(movement.newStock, 7);
  const productUpdate = state.writes.find((w) => w.model === 'product' && w.method === 'update');
  assert.deepEqual(productUpdate.where, { id: ID.product, organizationId: 'org-b' });
  assertScopedTo('org-b');
});

test('control positivo: el admin de B sí ve su movimiento', async () => {
  reset(ADMIN_B);
  const result = await stock.getStockMovementById(ID.stockMovement);
  assert.equal(result.status, 200);
  assert.equal(result.data.id, ID.stockMovement);
});

test('getStockMovements: filtros con forma inválida 400 sin consultar', async () => {
  reset(ADMIN_A);
  const result = await stock.getStockMovements({ userId: "' OR 1=1" });
  assert.equal(result.status, 400);
  assert.equal(state.calls.length, 0);
});

