import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_A, ADMIN_B, ID, assertContract, foreign, load, reset, state } from '../../../test/catalog-harness.mjs';

// Contrato de marcas (#12): tenant e identidad salen del actor de sesión.
const brand = await load('src/actions/brand/brand.actions.ts');
const emptyList = (data) => assert.deepEqual(data, []);

const actions = {
  getBrands: { run: () => brand.getBrands(), expectA: 200, empty: emptyList },
  getBrandById: { run: () => brand.getBrandById(ID.brand), expectA: 404 },
  updateBrand: { run: () => brand.updateBrand(ID.brand, { name: 'x', ...foreign }), expectA: 404, adminOnly: true },
  softDeleteBrand: { run: () => brand.softDeleteBrand(ID.brand), expectA: 404, adminOnly: true },
  deleteBrand: { run: () => brand.deleteBrand(ID.brand), expectA: 404, adminOnly: true },
};
for (const [name, spec] of Object.entries(actions)) assertContract(test, `brand.${name}`, spec);

test('brand.createBrand: sin sesión 401, SELLER 403, sin escrituras', async () => {
  for (const [actor, status] of [[null, 401], ['NO_MEMBERSHIP', 403], [{ ...ADMIN_A, role: 'SELLER' }, 403]]) {
    reset(actor);
    const result = await brand.createBrand({ name: 'Nueva' });
    assert.equal(result.status, status);
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.writes, []);
  }
});

test('brand.createBrand: ignora organizationId/userId y campos no permitidos', async () => {
  reset(ADMIN_A);
  const result = await brand.createBrand({ name: 'Nueva', description: 'd', ...foreign, logo: 'http://x' });
  assert.equal(result.status, 201);
  const created = state.writes.find((w) => w.model === 'brand' && w.method === 'create').data;
  assert.deepEqual(created, { name: 'Nueva', description: 'd', isActive: true, organizationId: 'org-a' });
});

test('brand: control positivo, el admin de B borra su marca con filtro de organización', async () => {
  reset(ADMIN_B);
  const result = await brand.deleteBrand(ID.brand);
  assert.equal(result.status, 200);
  const del = state.writes.find((w) => w.method === 'delete');
  assert.deepEqual(del.where, { id: ID.brand, organizationId: 'org-b' });
});
