import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const entry = resolve('src/actions/purchase/purchase.actions.ts');
const baseline = process.env.POS_02_BASELINE === '1';
const source = baseline ? execFileSync('git', ['show', 'origin/main:pos-system-client/src/actions/purchase/purchase.actions.ts'], { encoding: 'utf8' }) : null;
const state = { actor: null, purchases: [], locks: [], queries: [], date: '2026-11-15T15:00:00.000Z' };
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [state.date])); }
  static now() { return new RealDate(state.date).getTime(); }
};
const evaluate = (strings, values) => {
  const sql = strings.join('?');
  state.queries.push(sql);
  if (sql.includes('pg_advisory_xact_lock')) { state.locks.push(values[0]); return [{ pg_advisory_xact_lock: '' }]; }
  if (sql.includes('MAX(')) {
    const org = values[1];
    const pattern = new RegExp(values[2]);
    const ordinals = state.purchases.filter(p => p.organizationId === org && pattern.test(p.purchaseNumber)).map(p => BigInt(p.purchaseNumber.split('-').at(-1)));
    return [{ ordinal: { toString: () => String(ordinals.reduce((max, n) => n > max ? n : max, BigInt(0))) } }];
  }
  throw Error(`Unexpected SQL: ${sql}`);
};
const tx = {
  $queryRaw: async (strings, ...values) => evaluate(strings, values),
  purchase: {
    create: async ({ data }) => { const row = { id: crypto.randomUUID(), ...data }; state.purchases.push(row); return row; },
    findUnique: async ({ where }) => state.purchases.find(p => p.id === where.id),
  },
  purchaseItem: { create: async () => ({}) },
};
const prisma = {
  supplier: { findFirst: async () => ({ id: 'supplier' }) },
  product: { findMany: async ({ where }) => where.id.in.map(id => ({ id })) },
  purchase: { count: async () => state.purchases.length },
  $transaction: async fn => fn(tx),
};
globalThis.__purchaseNumberTest = { state, prisma };
const mocks = {
  '@/generated/prisma': 'export const Prisma = { Decimal: class Decimal {}, PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {} }; export const PurchaseStatus = {}; export const MembershipRole = { ADMIN: "ADMIN", SELLER: "SELLER" };',
  '../utils': 'export const prisma = globalThis.__purchaseNumberTest.prisma; export const serializeDecimals = x => x;',
  '@/lib/auth/actor': `
    class ActorError extends Error { constructor(status) { super('denied'); this.status = status; } }
    export const requireActor = async (options = {}) => {
      const actor = globalThis.__purchaseNumberTest.state.actor;
      if (!actor) throw new ActorError(401);
      if (options.roles && !options.roles.includes(actor.role)) throw new ActorError(403);
      return actor;
    };
    export const actorErrorResponse = error => error instanceof ActorError ? { status: error.status, message: error.message, data: null } : null;`,
};
const compiled = await build({
  ...(baseline ? { stdin: { contents: source, resolveDir: dirname(entry), sourcefile: entry, loader: 'ts' } } : { entryPoints: [entry] }),
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'mock-boundary', setup(plugin) {
    plugin.onResolve({ filter: /^(?:@\/generated\/prisma|\.\.\/utils|@\/lib\/auth\/actor)$/ }, args => ({ path: args.path, namespace: 'mock' }));
    plugin.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
  } }],
});
const { createPurchase } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const SUPPLIER = '00000000-0000-4000-8000-000000000001';
const PRODUCT = '00000000-0000-4000-8000-000000000002';
// La organización sale de la sesión; la del cliente se ignora.
const create = async (org) => createPurchase({ supplierId: SUPPLIER, organizationId: org, status: 'PENDING', purchaseDate: new Date(), total: 0 }, [{ productId: PRODUCT, quantity: 2, unitPrice: 5, subtotal: 10, unitMeasureId: 'unit' }]);

test('P0 contrato: tenants independientes, huecos históricos y soft-delete sin reuso', async () => {
  state.actor = { organizationId: 'org-a', role: 'ADMIN' };
  let result = await create('org-a');
  assert.equal(result.status, 201);
  assert.equal(result.data.purchaseNumber, 'COMP-20261115-0001');
  state.purchases[0].isDeleted = true;
  state.purchases.push({ organizationId: 'org-a', purchaseNumber: 'COMP-20261115-0007', isDeleted: true });
  state.purchases.push({ organizationId: 'org-a', purchaseNumber: 'COMP-20261115-invalid', isDeleted: false });
  result = await create('org-a');
  assert.equal(result.data.purchaseNumber, 'COMP-20261115-0008');
  state.actor = { organizationId: 'org-b', role: 'ADMIN' };
  result = await create('org-b');
  assert.equal(result.data.purchaseNumber, 'COMP-20261115-0001');
  assert.equal(state.locks.length, 3);
});

test('P0 contrato: día de negocio America/Bogota, cambio de día y createdAt coincidente', async () => {
  state.actor = { organizationId: 'org-a', role: 'ADMIN' };
  // 18:59 Bogotá: mismo día en UTC y en Bogotá.
  state.date = '2026-11-15T23:59:59.999Z';
  const before = await create('org-a');
  // 20:00 Bogotá = 01:00 UTC del día siguiente: sigue siendo 15 en Bogotá.
  state.date = '2026-11-16T01:00:00.000Z';
  const evening = await create('org-a');
  // 23:30 Bogotá = 04:30 UTC del día siguiente.
  state.date = '2026-11-16T04:30:00.000Z';
  const late = await create('org-a');
  // 00:00 Bogotá = 05:00 UTC: empieza el día 16.
  state.date = '2026-11-16T05:00:00.000Z';
  const after = await create('org-a');
  assert.equal(before.data.purchaseNumber, 'COMP-20261115-0009');
  assert.equal(evening.data.purchaseNumber, 'COMP-20261115-0010');
  assert.equal(late.data.purchaseNumber, 'COMP-20261115-0011');
  assert.equal(after.data.purchaseNumber, 'COMP-20261116-0001');
  assert.equal(before.data.createdAt.toISOString(), '2026-11-15T23:59:59.999Z');
  assert.equal(evening.data.createdAt.toISOString(), '2026-11-16T01:00:00.000Z');
  assert.equal(after.data.createdAt.toISOString(), '2026-11-16T05:00:00.000Z');
});

test('P0 contrato: sin sesión y seller no adquieren lock ni escriben', async () => {
  for (const actor of [null, { organizationId: 'org-a', role: 'SELLER' }]) {
    state.actor = actor;
    const locks = state.locks.length;
    const count = state.purchases.length;
    const response = await create('org-a');
    assert.equal(response.status, !actor ? 401 : 403);
    assert.equal(state.locks.length, locks);
    assert.equal(state.purchases.length, count);
  }
});
