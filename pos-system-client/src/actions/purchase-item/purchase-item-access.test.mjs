import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_B, ID, assertContract, foreign, load, reset, state } from '../../../test/catalog-harness.mjs';

// Contrato de ítems de compra (#13): solo administración; el filtro de
// organización pasa por la compra a la que pertenece el ítem.
const purchaseItem = await load('src/actions/purchase-item/purchase-item.actions.ts');

const actions = {
  getPurchaseItemsByPurchaseId: {
    run: () => purchaseItem.getPurchaseItemsByPurchaseId(ID.purchase), expectA: 200, adminOnly: true, empty: (data) => assert.deepEqual(data, []),
  },
  createPurchaseItem: {
    run: () => purchaseItem.createPurchaseItem(ID.purchase, { productId: ID.product, quantity: 2, unitPrice: 4, ...foreign }), expectA: 404, adminOnly: true,
  },
  updatePurchaseItem: { run: () => purchaseItem.updatePurchaseItem(ID.purchaseItem, { quantity: 3 }), expectA: 404, adminOnly: true },
  softDeletePurchaseItem: { run: () => purchaseItem.softDeletePurchaseItem(ID.purchaseItem), expectA: 404, adminOnly: true },
};
for (const [name, spec] of Object.entries(actions)) assertContract(test, `purchaseItem.${name}`, spec);

test('purchaseItem: control positivo, el admin de B edita su ítem y recalcula el total en su organización', async () => {
  reset(ADMIN_B);
  const result = await purchaseItem.updatePurchaseItem(ID.purchaseItem, { quantity: 3, purchaseId: 'otra' });
  assert.equal(result.status, 200);
  const update = state.writes.find((w) => w.model === 'purchaseItem' && w.method === 'update');
  assert.equal(update.where.purchase.organizationId, 'org-b');
  assert.deepEqual({ quantity: update.data.quantity, unitPrice: update.data.unitPrice, subtotal: update.data.subtotal }, { quantity: 3, unitPrice: 4, subtotal: 12 });
  const total = state.writes.find((w) => w.model === 'purchase' && w.method === 'update');
  assert.equal(total.where.organizationId, 'org-b');
});

test('purchaseItem.createPurchaseItem: ignora purchaseId y subtotal del cliente', async () => {
  reset(ADMIN_B);
  const result = await purchaseItem.createPurchaseItem(ID.purchase, { productId: ID.product, quantity: 2, unitPrice: 4, subtotal: 1, purchaseId: 'otra' });
  assert.equal(result.status, 201);
  const created = state.writes.find((w) => w.model === 'purchaseItem' && w.method === 'create').data;
  assert.deepEqual(created, { productId: ID.product, quantity: 2, unitPrice: 4, subtotal: 8, purchaseId: ID.purchase });
});
