import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const state = { actor: null, writes: 0, itemQueries: [] };
globalThis.__itemTest = state;
const prisma = {
  purchase: {
    findFirst: async ({ where }) => where.organizationId === 'org-b' ? { id: 'purchase-b', status: 'PENDING' } : null,
    update: async () => { state.writes++; },
  },
  purchaseItem: {
    findFirst: async ({ where }) => { state.itemQueries.push(where); return where.purchase?.organizationId === 'org-b' ? { id: 'item-b', purchaseId: 'purchase-b', purchase: { status: 'PENDING' }, quantity: 2, unitPrice: { toNumber: () => 4 } } : null; },
    findMany: async ({ where }) => { state.itemQueries.push(where); return []; },
    update: async () => { state.writes++; },
    create: async () => { state.writes++; },
    count: async () => 2,
  },
  product: { findFirst: async () => ({ id: 'product-b' }) },
};
globalThis.__itemPrisma = prisma;
const mocks = {
  '@/generated/prisma': 'export const Prisma = { PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {} };',
  '../utils': 'export const prisma = globalThis.__itemPrisma; export const serializeDecimals = value => value;',
  '../purchase/purchase-access': 'export const getPurchaseActor = async (adminOnly = false) => { const actor = globalThis.__itemTest.actor; return actor && (!adminOnly || actor.role === "ADMIN") ? { actor } : { status: actor ? 403 : 401 }; }; export const purchaseAccessError = status => ({ status, data: null });',
};
const result = await build({ entryPoints: [resolve('src/actions/purchase-item/purchase-item.actions.ts')], bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'fake-item-boundary', setup(plugin) {
  plugin.onResolve({ filter: /^(?:@\/generated\/prisma|\.\.\/utils|\.\.\/purchase\/purchase-access)$/ }, args => ({ path: args.path, namespace: 'mock' }));
  plugin.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
} }] });
const actions = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const calls = {
  list: () => actions.getPurchaseItemsByPurchaseId('purchase-b'),
  add: () => actions.createPurchaseItem('purchase-b', 'admin-b', { productId: 'product-b', quantity: 2, unitPrice: 4 }),
  edit: () => actions.updatePurchaseItem('item-b', 'admin-b', { quantity: 3 }),
  delete: () => actions.softDeletePurchaseItem('item-b', 'admin-b'),
};
for (const [name, run] of Object.entries(calls)) {
  test(`${name}: ítems de B inaccesibles desde A y sin sesión`, async () => {
    for (const actor of [null, { userId: 'seller-a', organizationId: 'org-a', role: 'SELLER' }, { userId: 'admin-a', organizationId: 'org-a', role: 'ADMIN' }]) {
      Object.assign(state, { actor, writes: 0, itemQueries: [] });
      const response = await run();
      assert.equal(response.status, !actor ? 401 : name === 'list' ? 200 : actor.role === 'SELLER' ? 403 : 404);
      assert.equal(state.writes, 0);
      for (const where of state.itemQueries) assert.equal(where.purchase.organizationId, 'org-a');
      if (name === 'list' && actor) assert.deepEqual(response.data, []);
    }
  });
}
