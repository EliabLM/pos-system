import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const state = { token: null, payload: null, session: null, user: null, membership: null, queries: [] };
globalThis.__authTest = state;
const mocks = {
  'next/headers': 'export const cookies = async () => ({ get: () => globalThis.__authTest.token ? { value: globalThis.__authTest.token } : undefined });',
  '@/generated/prisma': 'export const MembershipRole = { ADMIN: "ADMIN", SELLER: "SELLER" };',
  '@/lib/auth': 'export const verifyToken = () => globalThis.__authTest.payload; export const validateSession = async () => globalThis.__authTest.session;',
  '../utils': `export const prisma = {
    user: { findFirst: async query => { globalThis.__authTest.queries.push(['user', query]); return globalThis.__authTest.user; } },
    membership: { findFirst: async query => { globalThis.__authTest.queries.push(['membership', query]); return globalThis.__authTest.membership; } },
  };`,
};
const compiled = await build({ entryPoints: [resolve('src/actions/purchase/purchase-access.ts')], bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'fake-session-boundary', setup(plugin) {
  plugin.onResolve({ filter: /^(?:next\/headers|@\/generated\/prisma|@\/lib\/auth|\.\.\/utils)$/ }, args => ({ path: args.path, namespace: 'mock' }));
  plugin.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }));
} }] });
const { getPurchaseActor } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
function reset() {
  Object.assign(state, { token: 'signed', payload: { userId: 'admin-a' }, session: { userId: 'admin-a' }, user: { id: 'admin-a' }, membership: { organizationId: 'org-a', role: 'ADMIN' }, queries: [] });
}
test('ausencia de cookie y sesión inválida rechazan antes de consultar membresía', async () => {
  reset(); state.token = null;
  assert.equal((await getPurchaseActor()).status, 401);
  assert.equal(state.queries.length, 0);
  reset(); state.session = null;
  assert.equal((await getPurchaseActor()).status, 401);
  assert.equal(state.queries.length, 0);
  reset(); state.session = { userId: 'admin-b' };
  assert.equal((await getPurchaseActor()).status, 401);
  assert.equal(state.queries.length, 0);
});
test('membresía revocada/inexistente y usuario eliminado no acceden', async () => {
  reset(); state.membership = null;
  assert.equal((await getPurchaseActor()).status, 403);
  assert.deepEqual(state.queries[1][1].where, { userId: 'admin-a', deletedAt: null, status: 'ACTIVE', organization: { isDeleted: false, isActive: true } });
  reset(); state.user = null;
  assert.equal((await getPurchaseActor()).status, 401);
  assert.deepEqual(state.queries[0][1].where, { id: 'admin-a', isDeleted: false, isActive: true });
});
test('rol seller lee pero no modifica; admin autorizado obtiene tenant de membresía, no JWT', async () => {
  reset(); state.payload.organizationId = 'org-b'; state.membership.role = 'SELLER';
  assert.deepEqual((await getPurchaseActor()).actor, { userId: 'admin-a', organizationId: 'org-a', role: 'SELLER' });
  assert.equal((await getPurchaseActor(true)).status, 403);
  state.membership.role = 'ADMIN';
  assert.deepEqual((await getPurchaseActor(true)).actor, { userId: 'admin-a', organizationId: 'org-a', role: 'ADMIN' });
});
