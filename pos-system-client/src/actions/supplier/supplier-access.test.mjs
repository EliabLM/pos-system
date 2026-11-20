import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_A, ADMIN_B, ID, SELLER_A, assertContract, assertScopedTo, foreign, load, reset, state } from '../../../test/catalog-harness.mjs';

// Contrato de proveedores (#13): solo administración; tenant e identidad salen del actor.
const supplier = await load('src/actions/supplier/supplier.actions.ts');

const actions = {
  getSuppliers: { run: () => supplier.getSuppliers(), expectA: 200, adminOnly: true, empty: (data) => assert.deepEqual(data.suppliers, []) },
  getSupplierById: { run: () => supplier.getSupplierById(ID.supplier), expectA: 404, adminOnly: true },
  getSupplierByTaxId: { run: () => supplier.getSupplierByTaxId('900'), expectA: 404, adminOnly: true },
  getSupplierByEmail: { run: () => supplier.getSupplierByEmail('p@example.com'), expectA: 404, adminOnly: true },
  updateSupplier: { run: () => supplier.updateSupplier(ID.supplier, { name: 'x', ...foreign }), expectA: 404, adminOnly: true },
  softDeleteSupplier: { run: () => supplier.softDeleteSupplier(ID.supplier), expectA: 404, adminOnly: true },
  toggleSupplierActiveStatus: { run: () => supplier.toggleSupplierActiveStatus(ID.supplier), expectA: 404, adminOnly: true },
  getSupplierPurchaseHistory: { run: () => supplier.getSupplierPurchaseHistory(ID.supplier), expectA: 404, adminOnly: true },
  getSupplierStatistics: { run: () => supplier.getSupplierStatistics(ID.supplier), expectA: 404, adminOnly: true },
  getTopSuppliersByPurchases: { run: () => supplier.getTopSuppliersByPurchases(), expectA: 200, adminOnly: true, empty: (data) => assert.deepEqual(data, []) },
};
for (const [name, spec] of Object.entries(actions)) assertContract(test, `supplier.${name}`, spec);

test('supplier.createSupplier: sin sesión 401, sin membresía 403, SELLER 403, sin tocar la BD', async () => {
  for (const [actor, status] of [[null, 401], ['NO_MEMBERSHIP', 403], [SELLER_A, 403]]) {
    reset(actor);
    const result = await supplier.createSupplier({ name: 'Nuevo' });
    assert.equal(result.status, status);
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.writes, []);
  }
});

test('supplier.createSupplier: crea en la organización del actor e ignora tenancy y campos no permitidos', async () => {
  reset(ADMIN_A);
  const result = await supplier.createSupplier({ name: 'Nuevo', taxId: '', email: 'p@example.com', ...foreign, deletedAt: new Date() });
  assert.equal(result.status, 201);
  const created = state.writes.find((w) => w.model === 'supplier' && w.method === 'create').data;
  assert.equal(created.organizationId, 'org-a');
  assert.equal(created.taxId, null, 'NIT vacío se guarda como null');
  for (const key of ['userId', 'orgId', 'id', 'isDeleted', 'deletedAt']) assert.ok(!(key in created), `${key} no llega a Prisma`);
  assertScopedTo('org-a');
});

test('supplier: control positivo, el admin de B desactiva su proveedor con filtro de organización', async () => {
  reset(ADMIN_B);
  const result = await supplier.toggleSupplierActiveStatus(ID.supplier);
  assert.equal(result.status, 200);
  const update = state.writes.find((w) => w.model === 'supplier' && w.method === 'update');
  assert.deepEqual(update.where, { id: ID.supplier, organizationId: 'org-b', isDeleted: false });
  assert.equal(update.data.isActive, false);
});

test('supplier.getSupplierPurchaseHistory: las compras se filtran por la organización del actor', async () => {
  reset(ADMIN_B);
  const result = await supplier.getSupplierPurchaseHistory(ID.supplier);
  assert.equal(result.status, 200);
  for (const call of state.calls.filter((c) => c.model === 'purchase')) assert.equal(call.where.organizationId, 'org-b');
});
