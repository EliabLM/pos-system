import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_A, ADMIN_B, ID, assertContract, foreign, load, reset, state } from '../../../test/catalog-harness.mjs';

// Contrato de categorías (#12): tenant e identidad salen del actor de sesión.
const category = await load('src/actions/category/index.ts');
const emptyList = (data) => assert.deepEqual(data, []);

const actions = {
  getCategories: { run: () => category.getCategories(true), expectA: 200, empty: emptyList },
  getCategoryById: { run: () => category.getCategoryById(ID.category), expectA: 404 },
  updateCategory: { run: () => category.updateCategory(ID.category, { name: 'x', ...foreign }), expectA: 404, adminOnly: true },
  softDeleteCategory: { run: () => category.softDeleteCategory(ID.category), expectA: 404, adminOnly: true },
};
for (const [name, spec] of Object.entries(actions)) assertContract(test, `category.${name}`, spec);

test('category.createCategory: sin sesión 401, SELLER 403, sin escrituras', async () => {
  for (const [actor, status] of [[null, 401], ['NO_MEMBERSHIP', 403], [{ ...ADMIN_A, role: 'SELLER' }, 403]]) {
    reset(actor);
    const result = await category.createCategory({ name: 'Nueva' });
    assert.equal(result.status, status);
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.writes, []);
  }
});

test('category.createCategory: ignora organizationId/userId del cliente', async () => {
  reset(ADMIN_A);
  const result = await category.createCategory({ name: 'Nueva', ...foreign });
  assert.equal(result.status, 201);
  const created = state.writes.find((w) => w.model === 'category' && w.method === 'create').data;
  assert.deepEqual(created, { name: 'Nueva', description: null, isActive: true, organizationId: 'org-a' });
});

test('category: control positivo, el admin de B actualiza su categoría con filtro de organización', async () => {
  reset(ADMIN_B);
  const result = await category.updateCategory(ID.category, { name: 'Renombrada', organizationId: 'org-a' });
  assert.equal(result.status, 200);
  const update = state.writes.find((w) => w.method === 'update');
  assert.deepEqual(update.where, { id: ID.category, organizationId: 'org-b', isDeleted: false });
  assert.ok(!('organizationId' in update.data));
});
