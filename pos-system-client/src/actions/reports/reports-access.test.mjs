import test from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_A, ADMIN_B, ID, assertContract, assertScopedTo, foreign, load, reset, state } from '../../../test/catalog-harness.mjs';

// Contrato de reportes (#15): son del ADMIN (lib/rbac.ts), siempre de su organización
// y siempre con un rango de fechas.
const reports = await load('src/actions/reports/index.ts');

const dateRange = { startDate: new Date('2026-11-01T12:00:00Z'), endDate: new Date('2026-11-15T12:00:00Z') };
const filters = { dateRange, period: 'day' };
const financial = { startDate: '2026-11-01', endDate: '2026-11-15' };

const run = {
  getSalesReport: (f = filters) => reports.getSalesReport(f),
  getSalesByProduct: (f = filters) => reports.getSalesByProduct(f),
  getSalesByCategory: (f = filters) => reports.getSalesByCategory(f),
  getSalesByPayment: (f = filters) => reports.getSalesByPayment(f),
  getSalesBySeller: (f = filters) => reports.getSalesBySeller(f),
  getStockStatusReport: (f = filters) => reports.getStockStatusReport(f),
  getStockMovementsReport: (f = filters) => reports.getStockMovementsReport(f),
  getInventoryValuationReport: (f = filters) => reports.getInventoryValuationReport(f),
  getInventoryRotationReport: (f = filters) => reports.getInventoryRotationReport(f),
  getCustomerSummary: (f = filters) => reports.getCustomerSummary(f),
  getTopCustomers: (f = filters) => reports.getTopCustomers(f),
  getCustomerSegments: (f = filters) => reports.getCustomerSegments(f),
  getCustomerRetention: (f = filters) => reports.getCustomerRetention(f),
  getCohortAnalysis: (f = filters) => reports.getCohortAnalysis(f),
  getCustomerActivitySegments: (f = filters) => reports.getCustomerActivitySegments(f),
  getProfitLossReport: (f = financial) => reports.getProfitLossReport(f),
  getProfitabilityReport: (f = financial) => reports.getProfitabilityReport(f),
  getCashFlowReport: (f = financial) => reports.getCashFlowReport(f),
};
const isFinancial = (name) => ['getProfitLossReport', 'getProfitabilityReport', 'getCashFlowReport'].includes(name);

for (const [name, fn] of Object.entries(run)) {
  assertContract(test, `reports.${name}`, { run: () => fn(), expectA: 200, adminOnly: true });
}
assertContract(test, 'reports.getCustomerPurchaseHistory', {
  run: () => reports.getCustomerPurchaseHistory(ID.customer, filters), expectA: 404, adminOnly: true,
});

test('reports: sin rango de fechas, o con el inicio después del fin, responde 400 sin tocar la BD', async () => {
  for (const [name, fn] of Object.entries(run)) {
    const missing = isFinancial(name) ? {} : { period: 'day' };
    const reversed = isFinancial(name)
      ? { startDate: '2026-11-15', endDate: '2026-11-01' }
      : { dateRange: { startDate: dateRange.endDate, endDate: dateRange.startDate } };
    const invalid = isFinancial(name) ? { startDate: 'no-es-fecha', endDate: '2026-11-01' } : { dateRange: { startDate: 'x', endDate: 'y' } };
    for (const f of [missing, reversed, invalid]) {
      reset(ADMIN_A);
      const result = await fn(f);
      assert.equal(result.status, 400, `${name} con ${JSON.stringify(f)}`);
      assert.equal(state.calls.length, 0, name);
    }
  }
});

test('reports: ignora la organización enviada por el cliente y filtra por la del actor', async () => {
  for (const [name, fn] of Object.entries(run)) {
    reset(ADMIN_A);
    const result = await fn({ ...(isFinancial(name) ? financial : filters), ...foreign });
    assert.equal(result.status, 200, name);
    assertScopedTo('org-a');
  }
});

test('reports: control positivo, el admin de B filtra por tienda y vendedor dentro de su organización', async () => {
  reset(ADMIN_B);
  const result = await reports.getSalesBySeller({ ...filters, storeId: ID.storeB, sellerId: '00000000-0000-4000-8000-0000000000c1' });
  assert.equal(result.status, 200);
  const call = state.calls.find((c) => c.model === 'sale' && c.method === 'findMany');
  assert.equal(call.where.organizationId, 'org-b');
  assert.equal(call.where.storeId, ID.storeB);
  assert.equal(call.where.userId, '00000000-0000-4000-8000-0000000000c1');
  assert.deepEqual(result.data.map((s) => [s.sellerName, s.salesCount, s.totalRevenue]), [['Vendedor B', 1, 10]]);
});

test('reports: un ID de filtro mal formado responde 400 sin tocar la BD', async () => {
  for (const f of [{ ...filters, storeId: 'no-es-un-id' }, { ...filters, sellerId: 'x' }]) {
    reset(ADMIN_A);
    const result = await reports.getSalesReport(f);
    assert.equal(result.status, 400);
    assert.equal(state.calls.length, 0);
  }
  reset(ADMIN_A);
  const history = await reports.getCustomerPurchaseHistory('no-es-un-id', filters);
  assert.equal(history.status, 400);
  assert.equal(state.calls.length, 0);
});
