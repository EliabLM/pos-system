import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_A, ID, SELLER_A, assertContract, assertScopedTo, foreign, load, reset, state } from '../../../test/catalog-harness.mjs';

// Contrato del dashboard (#15): todo miembro lo lee, siempre acotado a su organización;
// el vendedor con tienda asignada solo ve su tienda.
const dashboard = await load('src/actions/dashboard/index.ts');

const emptyList = (data) => assert.deepEqual(data, []);
const actions = {
  getDashboardKPIs: { run: () => dashboard.getDashboardKPIs(), expectA: 200 },
  getSalesByPeriod: { run: () => dashboard.getSalesByPeriod('week'), expectA: 200 },
  getTopProducts: { run: () => dashboard.getTopProducts('month'), expectA: 200, empty: emptyList },
  getCashStatus: { run: () => dashboard.getCashStatus(), expectA: 200, empty: emptyList },
  getStockAlerts: { run: () => dashboard.getStockAlerts(), expectA: 200, empty: emptyList },
};
for (const [name, spec] of Object.entries(actions)) assertContract(test, `dashboard.${name}`, spec);

test('dashboard: no acepta el ID de organización del cliente (lo que llegue se ignora)', async () => {
  reset(ADMIN_A);
  const result = await dashboard.getDashboardKPIs({ ...foreign });
  assert.equal(result.status, 400, 'una tienda que no es un ID es entrada inválida');
  assert.equal(state.calls.length, 0);

  reset(ADMIN_A);
  await dashboard.getStockAlerts(null);
  assertScopedTo('org-a');
});

test('dashboard: el vendedor con tienda asignada solo ve su tienda, aunque pida otra', async () => {
  reset({ ...SELLER_A, storeId: ID.storeA });
  for (const run of [
    () => dashboard.getDashboardKPIs(ID.storeB),
    () => dashboard.getSalesByPeriod('week', ID.storeB),
    () => dashboard.getTopProducts('week', ID.storeB),
    () => dashboard.getCashStatus(ID.storeB),
  ]) {
    state.calls = [];
    const result = await run();
    assert.equal(result.status, 200);
    for (const call of state.calls) {
      const storeId = call.where.storeId ?? call.where.sale?.storeId;
      assert.equal(storeId, ID.storeA, `${call.model}.${call.method} filtra por la tienda del vendedor`);
    }
  }
});

test('dashboard: el admin filtra por la tienda que pide, dentro de su organización', async () => {
  reset(ADMIN_A);
  await dashboard.getDashboardKPIs(ID.storeA);
  const call = state.calls.find((c) => c.model === 'sale' && c.method === 'aggregate');
  assert.equal(call.where.storeId, ID.storeA);
  assert.equal(call.where.organizationId, 'org-a');
});

test('dashboard: entradas inválidas responden 400 sin tocar la BD', async () => {
  for (const run of [
    () => dashboard.getSalesByPeriod('decade'),
    () => dashboard.getSalesByPeriod('week', null, 'no-es-fecha'),
    () => dashboard.getTopProducts('week', null, 0),
    () => dashboard.getTopProducts('week', null, 1000),
    () => dashboard.getCashStatus(null, 'no-es-fecha'),
    () => dashboard.getStockAlerts('no-es-un-id'),
  ]) {
    reset(ADMIN_A);
    const result = await run();
    assert.equal(result.status, 400);
    assert.equal(state.calls.length, 0);
  }
});
