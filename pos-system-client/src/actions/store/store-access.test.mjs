import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_A, ADMIN_B, ID, SELLER_A, assertContract, assertScopedTo, foreign, load, reset, state } from '../../../test/catalog-harness.mjs';

// Contrato de tiendas (#14): el vendedor lee las tiendas activas para vender; administrarlas es del ADMIN.
const store = await load('src/actions/store/store.actions.ts');

const actions = {
  getStores: { run: () => store.getStores(), expectA: 200, empty: (data) => assert.deepEqual(data, []) },
  getStoreById: { run: () => store.getStoreById(ID.storeB), expectA: 404 },
  getNextSaleNumber: { run: () => store.getNextSaleNumber(ID.storeB), expectA: 404 },
  getStoreWithSalesInfo: { run: () => store.getStoreWithSalesInfo(ID.storeB), expectA: 404, adminOnly: true },
  updateStore: { run: () => store.updateStore(ID.storeB, { name: 'x', ...foreign }), expectA: 404, adminOnly: true },
  softDeleteStore: { run: () => store.softDeleteStore(ID.storeB), expectA: 404, adminOnly: true },
  restoreStore: { run: () => store.restoreStore(ID.storeB), expectA: 404, adminOnly: true },
  deleteStore: { run: () => store.deleteStore(ID.storeB), expectA: 404, adminOnly: true },
};
for (const [name, spec] of Object.entries(actions)) assertContract(test, `store.${name}`, spec);

test('store.getStores: el vendedor solo ve las activas, aunque pida las borradas', async () => {
  reset(SELLER_A);
  const result = await store.getStores(false, true);
  assert.equal(result.status, 200);
  const call = state.calls.find((c) => c.model === 'store' && c.method === 'findMany');
  assert.deepEqual(call.where, { organizationId: 'org-a', isDeleted: false, isActive: true });
});

test('store.getStoreById: el vendedor solo ve tiendas activas', async () => {
  reset(SELLER_A);
  await store.getStoreById(ID.storeB);
  const call = state.calls.find((c) => c.model === 'store' && c.method === 'findFirst');
  assert.deepEqual(call.where, { id: ID.storeB, organizationId: 'org-a', isDeleted: false, isActive: true });
});

test('store.getNextSaleNumber: control positivo, el admin de B obtiene el consecutivo de su tienda', async () => {
  reset(ADMIN_B);
  const result = await store.getNextSaleNumber(ID.storeB);
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { nextSaleNumber: 8, saleNumberPrefix: 'tienda-b', fullSaleNumber: 'tienda-b0008' });
});

test('store.getStoreWithSalesInfo: los usuarios de la tienda no incluyen el hash de la contraseña', async () => {
  reset(ADMIN_B);
  const result = await store.getStoreWithSalesInfo(ID.storeB);
  assert.equal(result.status, 200);
  const { include } = state.calls.find((c) => c.model === 'store' && c.method === 'findFirst');
  for (const user of [include.memberships.include.user, include.sales.include.user]) {
    assert.ok(user.select, 'el usuario se lee con select explícito');
    assert.equal(user.select.passwordHash, undefined);
  }
});

test('store: un ID mal formado responde 400 sin tocar la BD', async () => {
  reset(ADMIN_B);
  const result = await store.getStoreById('no-es-un-id');
  assert.equal(result.status, 400);
  assert.equal(state.calls.length, 0);
});

test('store.createStore: sin sesión 401, sin membresía 403, SELLER 403, sin tocar la BD', async () => {
  for (const [actor, status] of [[null, 401], ['NO_MEMBERSHIP', 403], [SELLER_A, 403]]) {
    reset(actor);
    const result = await store.createStore({ name: 'Centro', address: 'Calle 1' });
    assert.equal(result.status, status);
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.writes, []);
  }
});

test('store.createStore: crea en la organización del actor e ignora tenancy, consecutivo y campos no permitidos', async () => {
  reset(ADMIN_A);
  const result = await store.createStore({
    name: 'Centro', address: 'Calle 1', description: '', phone: null, saleNumberPrefix: 'centro',
    city: 'Cartagena', department: 'Bolívar', isActive: true, ...foreign, lastSaleNumber: 999, deletedAt: new Date(),
  });
  assert.equal(result.status, 201);
  const created = state.writes.find((w) => w.model === 'store' && w.method === 'create').data;
  assert.deepEqual(created, {
    name: 'Centro', address: 'Calle 1', description: null, phone: null, saleNumberPrefix: 'centro',
    city: 'Cartagena', department: 'Bolívar', isActive: true, organizationId: 'org-a', lastSaleNumber: 0,
  });
  assertScopedTo('org-a');

  reset(ADMIN_A);
  const invalid = await store.createStore({ name: 'Sin dirección', address: '' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(state.writes, []);
});

test('store: control positivo, el admin de B edita su tienda con filtro de organización y sin tocar el prefijo', async () => {
  reset(ADMIN_B);
  const result = await store.updateStore(ID.storeB, { description: 'Sede norte', saleNumberPrefix: 'otro', lastSaleNumber: 0, ...foreign });
  assert.equal(result.status, 200);
  const update = state.writes.find((w) => w.model === 'store' && w.method === 'update');
  assert.deepEqual(update.where, { id: ID.storeB, organizationId: 'org-b', isDeleted: false });
  assert.equal(update.data.description, 'Sede norte');
  for (const key of ['saleNumberPrefix', 'lastSaleNumber', 'organizationId', 'isDeleted']) assert.equal(update.data[key], undefined, key);
});

test('store: no expone acciones para mover el consecutivo ni para leer tiendas de otro usuario', () => {
  assert.equal(store.incrementSaleNumber, undefined);
  assert.equal(store.getStoresByUserId, undefined);
});
