import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_A, ADMIN_B, ID, assertContract, assertScopedTo, foreign, load, reset, state } from '../../../test/catalog-harness.mjs';

// Contrato de unidades de medida (#12): tenant e identidad salen del actor de sesión.
const unit = await load('src/actions/unit-measure/index.ts');
const emptyList = (data) => assert.deepEqual(data, []);

const actions = {
  getUnitMeasures: { run: () => unit.getUnitMeasures(), expectA: 200, empty: emptyList },
  updateUnitMeasure: { run: () => unit.updateUnitMeasure(ID.unitMeasure, { name: 'x', ...foreign }), expectA: 404, adminOnly: true },
  softDeleteUnitMeasure: { run: () => unit.softDeleteUnitMeasure(ID.unitMeasure), expectA: 404, adminOnly: true },
};
for (const [name, spec] of Object.entries(actions)) assertContract(test, `unitMeasure.${name}`, spec);

test('unitMeasure.createUnitMeasure: sin sesión 401, SELLER 403, sin escrituras', async () => {
  for (const [actor, status] of [[null, 401], ['NO_MEMBERSHIP', 403], [{ ...ADMIN_A, role: 'SELLER' }, 403]]) {
    reset(actor);
    const result = await unit.createUnitMeasure({ name: 'Par', abbreviation: 'par' });
    assert.equal(result.status, status);
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.writes, []);
  }
});

test('unitMeasure.createUnitMeasure: ignora organizationId/userId y revisa duplicados en la organización del actor', async () => {
  reset(ADMIN_A);
  // "Unidad"/"un" existe en B, no en A: no es duplicado.
  const result = await unit.createUnitMeasure({ name: 'Unidad', abbreviation: 'un', ...foreign });
  assert.equal(result.status, 201);
  const created = state.writes.find((w) => w.model === 'unitMeasure' && w.method === 'create').data;
  assert.deepEqual(created, { name: 'Unidad', abbreviation: 'un', isActive: true, organizationId: 'org-a' });
  assertScopedTo('org-a');
});

test('unitMeasure: control positivo, el admin de B ve el duplicado en su organización', async () => {
  reset(ADMIN_B);
  const result = await unit.createUnitMeasure({ name: 'Unidad', abbreviation: 'un' });
  assert.equal(result.status, 400);
  assert.deepEqual(state.writes, []);
});
