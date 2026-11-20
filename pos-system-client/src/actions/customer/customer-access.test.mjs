import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_A, ADMIN_B, ID, SELLER_A, assertContract, assertScopedTo, foreign, load, reset, state } from '../../../test/catalog-harness.mjs';

// Contrato de clientes (#13): tenant e identidad salen del actor de sesión.
// El vendedor crea y busca clientes para vender; el resto es de administración.
const customer = await load('src/actions/customer/customer.actions.ts');
const emptyList = (data) => assert.deepEqual(data, []);

const actions = {
  getCustomers: { run: () => customer.getCustomers(), expectA: 200, empty: (data) => assert.deepEqual(data.customers, []) },
  getCustomerById: { run: () => customer.getCustomerById(ID.customer), expectA: 404 },
  getCustomerByEmail: { run: () => customer.getCustomerByEmail('b@example.com'), expectA: 404 },
  getCustomerByDocument: { run: () => customer.getCustomerByDocument('123'), expectA: 404 },
  updateCustomer: { run: () => customer.updateCustomer(ID.customer, { firstName: 'x', ...foreign }), expectA: 404, adminOnly: true },
  softDeleteCustomer: { run: () => customer.softDeleteCustomer(ID.customer), expectA: 404, adminOnly: true },
  toggleCustomerActiveStatus: { run: () => customer.toggleCustomerActiveStatus(ID.customer), expectA: 404, adminOnly: true },
  getCustomerPurchaseHistory: { run: () => customer.getCustomerPurchaseHistory(ID.customer), expectA: 404, adminOnly: true },
  getCustomerStatistics: { run: () => customer.getCustomerStatistics(ID.customer), expectA: 404, adminOnly: true },
  getTopCustomersByPurchases: { run: () => customer.getTopCustomersByPurchases(), expectA: 200, adminOnly: true, empty: emptyList },
};
for (const [name, spec] of Object.entries(actions)) assertContract(test, `customer.${name}`, spec);

test('customer.createCustomer: sin sesión 401 y sin membresía 403, sin tocar la BD', async () => {
  for (const [actor, status] of [[null, 401], ['NO_MEMBERSHIP', 403]]) {
    reset(actor);
    const result = await customer.createCustomer({ firstName: 'Ana', lastName: 'Ruiz' });
    assert.equal(result.status, status);
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.writes, []);
  }
});

test('customer.createCustomer: el vendedor crea en su organización e ignora tenancy y campos no permitidos', async () => {
  reset(SELLER_A);
  const result = await customer.createCustomer({ firstName: 'Ana', lastName: 'Ruiz', email: '', document: '  ', ...foreign, deletedAt: new Date() });
  assert.equal(result.status, 201);
  const created = state.writes.find((w) => w.model === 'customer' && w.method === 'create').data;
  assert.equal(created.organizationId, 'org-a');
  assert.equal(created.email, null, 'email vacío se guarda como null');
  assert.equal(created.document, null, 'documento vacío se guarda como null');
  for (const key of ['userId', 'orgId', 'id', 'isDeleted', 'deletedAt']) assert.ok(!(key in created), `${key} no llega a Prisma`);
  assertScopedTo('org-a');
});

test('customer.createCustomer: el email repetido se busca solo en la organización del actor', async () => {
  reset(ADMIN_A);
  const result = await customer.createCustomer({ firstName: 'Ana', lastName: 'Ruiz', email: 'b@example.com' });
  assert.equal(result.status, 201, 'el email de un cliente de B no choca en A');
  assertScopedTo('org-a');
});

test('customer.getCustomers: el vendedor solo ve clientes activos y no borrados, sin sus ventas', async () => {
  reset(SELLER_A);
  const result = await customer.getCustomers({ isActive: false }, true);
  assert.equal(result.status, 200);
  const call = state.calls.find((c) => c.model === 'customer' && c.method === 'findMany');
  assert.deepEqual({ org: call.where.organizationId, isDeleted: call.where.isDeleted, isActive: call.where.isActive }, { org: 'org-a', isDeleted: false, isActive: true });
  assert.equal(call.include, undefined, 'sin las ventas del cliente');
});

test('customer.getCustomers: filtros con forma inválida 400 sin consultar', async () => {
  reset(ADMIN_A);
  const result = await customer.getCustomers({ search: 1 });
  assert.equal(result.status, 400);
  assert.equal(state.calls.length, 0);
});

test('customer: control positivo, el admin de B edita su cliente con filtro de organización', async () => {
  reset(ADMIN_B);
  const result = await customer.updateCustomer(ID.customer, { firstName: 'Otro', organizationId: 'org-a' });
  assert.equal(result.status, 200);
  const update = state.writes.find((w) => w.model === 'customer' && w.method === 'update');
  assert.deepEqual(update.where, { id: ID.customer, organizationId: 'org-b', isDeleted: false });
  assert.ok(!('organizationId' in update.data));
});

test('customer.getCustomerStatistics: las ventas se filtran por la organización del actor', async () => {
  reset(ADMIN_B);
  const result = await customer.getCustomerStatistics(ID.customer);
  assert.equal(result.status, 200);
  for (const call of state.calls.filter((c) => c.model === 'sale')) assert.equal(call.where.organizationId, 'org-b');
  const items = state.calls.find((c) => c.model === 'saleItem' && c.method === 'groupBy');
  assert.equal(items.where.sale.organizationId, 'org-b');
});
