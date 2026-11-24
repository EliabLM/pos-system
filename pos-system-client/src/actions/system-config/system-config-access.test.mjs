import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_A, ADMIN_B, SELLER_A, assertContract, foreign, load, reset, state } from '../../../test/catalog-harness.mjs';

// Contrato de configuración (#14): el vendedor solo lee el tipo de negocio; el resto es del ADMIN.
const config = await load('src/actions/system-config/system-config.action.ts');

const actions = {
  getBusinessType: { run: () => config.getBusinessType(), expectA: 200, empty: (data) => assert.equal(data, null) },
  getSystemConfig: { run: () => config.getSystemConfig('business_type'), expectA: 404, adminOnly: true },
  getAllSystemConfigs: { run: () => config.getAllSystemConfigs(), expectA: 200, adminOnly: true, empty: (data) => assert.deepEqual(data, []) },
  updateSystemConfig: { run: () => config.updateSystemConfig('currency', 'COP'), expectA: 404, adminOnly: true },
};
for (const [name, spec] of Object.entries(actions)) assertContract(test, `systemConfig.${name}`, spec);

test('systemConfig.getBusinessType: el vendedor lee el tipo de negocio de su organización', async () => {
  reset({ ...SELLER_A, organizationId: 'org-b' });
  const result = await config.getBusinessType();
  assert.equal(result.status, 200);
  assert.equal(result.data, 'shoe_store');
});

test('systemConfig.createSystemConfig: sin sesión 401, sin membresía 403, SELLER 403, sin tocar la BD', async () => {
  for (const [actor, status] of [[null, 401], ['NO_MEMBERSHIP', 403], [SELLER_A, 403]]) {
    reset(actor);
    const result = await config.createSystemConfig({ key: 'currency', value: 'COP' });
    assert.equal(result.status, status);
    assert.equal(state.calls.length, 0);
    assert.deepEqual(state.writes, []);
  }
});

test('systemConfig.createSystemConfig: crea en la organización del actor e ignora tenancy', async () => {
  reset(ADMIN_A);
  const result = await config.createSystemConfig({ key: 'currency', value: 'COP', ...foreign });
  assert.equal(result.status, 201);
  const created = state.writes.find((w) => w.model === 'systemConfig' && w.method === 'create').data;
  assert.deepEqual(created, { key: 'currency', value: 'COP', type: 'STRING', description: null, organizationId: 'org-a' });
});

test('systemConfig: el tipo de negocio no se crea ni se cambia después del onboarding', async () => {
  reset(ADMIN_B);
  assert.equal((await config.createSystemConfig({ key: 'business_type', value: 'liquor_store' })).status, 403);
  assert.equal((await config.updateSystemConfig('business_type', 'liquor_store')).status, 403);
  assert.deepEqual(state.writes, []);
  assert.equal(config.setBusinessType, undefined, 'no es una acción pública');
});

test('systemConfig.updateSystemConfig: control positivo, el admin de B cambia su configuración con filtro de organización', async () => {
  reset(ADMIN_B);
  const result = await config.updateSystemConfig('currency', 'USD');
  assert.equal(result.status, 200);
  const update = state.writes.find((w) => w.model === 'systemConfig' && w.method === 'update');
  assert.equal(update.where.organizationId, 'org-b');
  assert.equal(update.data.value, 'USD');
});
