// CC-POS-13: "hoy" en dashboard y reportes usa el día de negocio America/Bogota.
// Las acciones se compilan con esbuild y prisma se sustituye por un doble en
// memoria que aplica el filtro saleDate { gte, lte } sobre ventas de prueba.
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

process.env.TZ = 'UTC'; // como el contenedor de producción

const state = { now: '2026-11-16T04:45:00.000Z' }; // 23:45 Bogotá del 15
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [state.now])); }
  static now() { return new RealDate(state.now).getTime(); }
};

const sale = (id, iso) => ({ id, saleDate: new RealDate(iso), total: 100, status: 'PAID', isDeleted: false, saleItems: [], salePayments: [] });
const sales = [
  sale('ayer-2330', '2026-11-15T04:30:00.000Z'), // 23:30 Bogotá del 14
  sale('hoy-0005', '2026-11-15T05:05:00.000Z'), // 00:05 Bogotá del 15
  sale('hoy-2000', '2026-11-16T01:00:00.000Z'), // 20:00 Bogotá del 15
  sale('hoy-2330', '2026-11-16T04:30:00.000Z'), // 23:30 Bogotá del 15
  sale('manana-0030', '2026-11-16T05:30:00.000Z'), // 00:30 Bogotá del 16
];
const inRange = (s, range) => (!range?.gte || s.saleDate >= range.gte) && (!range?.lte || s.saleDate <= range.lte);
const match = where => sales.filter(s => inRange(s, where.saleDate) && (!where.status || s.status === where.status));
const calls = [];
const prisma = {
  sale: {
    aggregate: async ({ where }) => {
      calls.push(where.saleDate);
      const rows = match(where);
      const sum = rows.reduce((acc, s) => acc + s.total, 0);
      return { _count: { id: rows.length }, _sum: { total: rows.length ? sum : null }, _avg: { total: rows.length ? sum / rows.length : null } };
    },
    findMany: async ({ where }) => { calls.push(where.saleDate); return match(where); },
  },
  salePayment: {
    findMany: async ({ where }) => {
      calls.push(where.sale.saleDate);
      return match(where.sale).map(s => ({ paymentMethodId: 'cash', amount: s.total, paymentMethod: { id: 'cash', name: 'Efectivo', type: 'CASH' }, sale: s }));
    },
  },
};
globalThis.__businessDayTest = { prisma };

const load = async entry => {
  const compiled = await build({
    entryPoints: [resolve(entry)], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'mock-boundary', setup(plugin) {
      plugin.onResolve({ filter: /^(?:@\/generated\/prisma|\.\.\/utils)$/ }, args => ({ path: args.path, namespace: 'mock' }));
      plugin.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({
        loader: 'js',
        contents: args.path === '../utils'
          ? 'export const prisma = globalThis.__businessDayTest.prisma; export const checkOrgId = id => !id; export const emptyOrgIdResponse = () => ({ status: 400, data: null });'
          : 'export const Prisma = {};',
      }));
    } }],
  });
  return import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
};

const { getDashboardKPIs } = await load('src/actions/dashboard/get-kpis.ts');
const { getCashStatus } = await load('src/actions/dashboard/get-cash-status.ts');
const { getSalesReport } = await load('src/actions/reports/sales-reports.ts');

test('P0 zona horaria: KPIs de hoy incluyen 23:30 Bogotá y excluyen 00:30 del día siguiente', async () => {
  calls.length = 0;
  const res = await getDashboardKPIs('org-a');
  assert.equal(res.status, 200);
  assert.equal(res.data.totalTransactions, 3); // 00:05, 20:00 y 23:30 del 15
  assert.equal(calls[0].gte.toISOString(), '2026-11-15T05:00:00.000Z');
  assert.equal(calls[0].lte.toISOString(), '2026-11-16T04:59:59.999Z');
  // Ayer (14 en Bogotá) contiene solo la venta de las 23:30 del 14.
  assert.equal(calls[1].gte.toISOString(), '2026-11-14T05:00:00.000Z');
  assert.equal(res.data.salesChange, 200);
});

test('P0 zona horaria: caja del día YYYY-MM-DD usa el día de Bogotá', async () => {
  const res = await getCashStatus('org-a', null, '2026-11-15');
  assert.equal(res.status, 200);
  assert.equal(res.data[0].transactionCount, 3);
  const bad = await getCashStatus('org-a', null, 'no-es-fecha');
  assert.equal(bad.status, 400);
});

test('P0 zona horaria: reporte de ventas "hoy" (instante actual) agrupa 23:30 en el día de Bogotá', async () => {
  const now = new Date();
  const res = await getSalesReport({ organizationId: 'org-a', dateRange: { startDate: now, endDate: now }, period: 'day' });
  assert.equal(res.status, 200);
  assert.equal(res.data.summary.totalSales, 3);
  assert.deepEqual(res.data.data.map(d => d.period), ['2026-11-15']);
  assert.equal(res.data.data[0].date.toISOString(), '2026-11-15T05:00:00.000Z');
  // Al día siguiente, la venta de las 00:30 cae en el 16.
  state.now = '2026-11-16T12:00:00.000Z';
  const next = await getSalesReport({ organizationId: 'org-a', dateRange: { startDate: new Date(), endDate: new Date() }, period: 'day' });
  assert.deepEqual(next.data.data.map(d => [d.period, d.salesCount]), [['2026-11-16', 1]]);
  state.now = '2026-11-16T04:45:00.000Z';
});
