import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_A, ADMIN_B, ID, SELLER_A, assertContract, foreign, load, reset, state } from '../../../test/catalog-harness.mjs';

// Contrato de medios de pago (#13): el vendedor los lista para cobrar; administrarlos es del ADMIN.
const paymentMethod = await load('src/actions/payment-methods/payment-methods.action.ts');

const actions = {
  getPaymentMethods: { run: () => paymentMethod.getPaymentMethods(), expectA: 200, empty: (data) => assert.deepEqual(data, []) },
  getPaymentMethodById: { run: () => paymentMethod.getPaymentMethodById(ID.paymentMethod), expectA: 404 },
  updatePaymentMethod: { run: () => paymentMethod.updatePaymentMethod(ID.paymentMethod, { name: 'x', ...foreign }), expectA: 404, adminOnly: true },
  softDeletePaymentMethod: { run: () => paymentMethod.softDeletePaymentMethod(ID.paymentMethod), expectA: 404, adminOnly: true },
  deletePaymentMethod: { run: () => paymentMethod.deletePaymentMethod(ID.paymentMethod), expectA: 404, adminOnly: true },
};
for (const [name, spec] of Object.entries(actions)) assertContract(test, `paymentMethod.${name}`, spec);

test('paymentMethod.createPaymentMethod: sin sesión 401, sin membresía 403, SELLER 403, sin tocar la BD', async () => {
  for (const [actor, status] of [[null, 401], ['NO_MEMBERSHIP', 403], [SELLER_A, 403]]) {
    reset(actor);
    const result = await paymentMethod.createPaymentMethod({ name: 'Nequi', type: 'TRANSFER' });
    assert.equal(result.status, status);
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.writes, []);
  }
});

test('paymentMethod.createPaymentMethod: ignora tenancy y campos no permitidos; tipo inválido 400', async () => {
  reset(ADMIN_A);
  const result = await paymentMethod.createPaymentMethod({ name: 'Nequi', type: 'TRANSFER', ...foreign, deletedAt: new Date() });
  assert.equal(result.status, 201);
  const created = state.writes.find((w) => w.model === 'paymentMethod' && w.method === 'create').data;
  assert.deepEqual(created, { name: 'Nequi', type: 'TRANSFER', isActive: true, organizationId: 'org-a' });

  reset(ADMIN_A);
  const invalid = await paymentMethod.createPaymentMethod({ name: 'Bitcoin', type: 'CRYPTO' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(state.writes, []);
});

test('paymentMethod.getPaymentMethods: el vendedor solo ve los activos', async () => {
  reset(SELLER_A);
  const result = await paymentMethod.getPaymentMethods(false);
  assert.equal(result.status, 200);
  const call = state.calls.find((c) => c.model === 'paymentMethod' && c.method === 'findMany');
  assert.deepEqual(call.where, { organizationId: 'org-a', isDeleted: false, isActive: true });
});

test('paymentMethod: control positivo, el admin de B borra su medio de pago con filtro de organización', async () => {
  reset(ADMIN_B);
  const result = await paymentMethod.softDeletePaymentMethod(ID.paymentMethod);
  assert.equal(result.status, 200);
  const update = state.writes.find((w) => w.model === 'paymentMethod' && w.method === 'update');
  assert.deepEqual(update.where, { id: ID.paymentMethod, organizationId: 'org-b', isDeleted: false });
});
