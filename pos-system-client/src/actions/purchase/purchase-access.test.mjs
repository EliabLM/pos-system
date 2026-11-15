import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const entry = resolve('src/actions/purchase/purchase.actions.ts');
const state = { actor: null, calls: [], writes: 0 };
const purchaseB = { id: 'purchase-b', organizationId: 'org-b', status: 'PENDING', isDeleted: false, purchaseItems: [{ productId: 'product-b', quantity: 2 }], total: { toNumber: () => 12.5 } };
const prisma = {
  purchase: {
    findFirst: async ({ where }) => { state.calls.push(where); return (!where.organizationId || where.organizationId === purchaseB.organizationId) && where.id === purchaseB.id ? purchaseB : null; },
    update: async ({ data }) => { state.writes++; state.lastUpdate = data; return purchaseB; },
    count: async () => 0,
    findMany: async () => [],
    findUnique: async () => purchaseB,
  },
  product: { findUnique: async () => { state.writes++; return { currentStock: 1 }; }, update: async () => { state.writes++; } },
  stockMovement: { create: async ({ data }) => { state.writes++; state.movement = data; } },
  $transaction: async (fn) => { state.writes++; return fn(prisma); },
};
globalThis.__purchaseTest = { state, prisma };
const mocks = {
  '@/generated/prisma': "export const Prisma = { Decimal: class Decimal {}, PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {} }; export const PurchaseStatus = {};",
  '../utils': 'export const prisma = globalThis.__purchaseTest.prisma; export const serializeDecimals = value => value; export const checkAdminRole = async () => true; export const unauthorizedResponse = () => ({ status: 403, data: null }); export const checkOrgId = () => false; export const emptyOrgIdResponse = () => ({ status: 400, data: null });',
  './purchase-access': 'export const getPurchaseActor = async (adminOnly = false) => { const actor = globalThis.__purchaseTest.state.actor; return actor && (!adminOnly || actor.role === "ADMIN") ? { actor } : { status: actor ? 403 : 401 }; }; export const purchaseAccessError = status => ({ status, message: "Acceso denegado", data: null });',
};
const baseline = process.env.POS_01_BASELINE === '1';
const original = baseline ? execFileSync('git', ['show', 'origin/main:pos-system-client/src/actions/purchase/purchase.actions.ts'], { encoding: 'utf8' }) : null;
const compiled = await build({
  ...(baseline ? { stdin: { contents: original, resolveDir: dirname(entry), sourcefile: entry, loader: 'ts' } } : { entryPoints: [entry] }),
  bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'mock-action-boundary', setup(plugin) {
  plugin.onResolve({ filter: /^(?:@\/generated\/prisma|\.\.\/utils|\.\/purchase-access)$/ }, args => ({ path: args.path, namespace: 'mock' }));
  plugin.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
} }] });
const actions = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const invoke = {
  get: () => actions.getPurchaseById('purchase-b'),
  update: () => actions.updatePurchase('purchase-b', 'admin-b', { notes: 'invasión' }),
  receive: () => actions.receivePurchase('purchase-b', 'admin-b'),
  cancel: () => actions.cancelPurchase('purchase-b', 'admin-b', 'invasión'),
  delete: () => actions.softDeletePurchase('purchase-b', 'admin-b'),
};
for (const [name, action] of Object.entries(invoke)) {
  test(`${name}: sin sesión, seller y admin de A no leen ni modifican compra B`, async () => {
    for (const actor of [null, { userId: 'seller-a', organizationId: 'org-a', role: 'SELLER' }, { userId: 'admin-a', organizationId: 'org-a', role: 'ADMIN' }]) {
      state.actor = actor; state.calls = []; state.writes = 0;
      const result = await action();
      assert.equal(result.status, !actor ? 401 : actor.role === 'SELLER' && name !== 'get' ? 403 : 404);
      assert.equal(result.data, null);
      assert.equal(state.writes, 0, 'sin cambios en compras, movimientos ni stock');
      for (const where of state.calls) assert.deepEqual(where, { id: 'purchase-b', organizationId: 'org-a', isDeleted: false });
    }
  });
}
test('admin B: lectura disponible y recepción usa identidad de sesión', async () => {
  state.actor = { userId: 'admin-b', organizationId: 'org-b', role: 'ADMIN' };
  const read = await actions.getPurchaseById('purchase-b');
  assert.equal(read.status, 200);
  assert.equal(read.data.total.toNumber(), 12.5);
  state.writes = 0;
  const received = await actions.receivePurchase('purchase-b', 'admin-a');
  assert.equal(received.status, 200);
  assert.ok(state.writes > 0);
  assert.equal(state.movement.userId, 'admin-b');
  assert.equal(state.movement.organizationId, 'org-b');
  await actions.updatePurchase('purchase-b', 'admin-a', { notes: 'ok', organizationId: 'org-a', status: 'CANCELLED' });
  assert.equal(state.lastUpdate.notes, 'ok');
  assert.equal(state.lastUpdate.organizationId, undefined);
  assert.equal(state.lastUpdate.status, undefined);
});
