import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from '../../../test/load-with-mocks.mjs';

// getPurchaseActor delega en el actor central (src/lib/auth/actor.ts, probado en actor.test.mjs).
const state = { outcome: null, calls: [] };
globalThis.__purchaseActorTest = state;
const { getPurchaseActor } = await loadWithMocks('src/actions/purchase/purchase-access.ts', {
  '@/generated/prisma': 'export const MembershipRole = { ADMIN: "ADMIN", SELLER: "SELLER" };',
  '@/lib/auth/actor': `
    export class ActorError extends Error { constructor(code) { super(code); this.code = code; this.status = code === 'UNAUTHENTICATED' ? 401 : 403; } }
    export const requireActor = async (options = {}) => {
      const s = globalThis.__purchaseActorTest; s.calls.push(options);
      if (s.outcome instanceof Error) throw s.outcome;
      if (s.outcome === 'UNAUTHENTICATED' || s.outcome === 'FORBIDDEN') throw new ActorError(s.outcome);
      if (options.roles && !options.roles.includes(s.outcome.role)) throw new ActorError('FORBIDDEN');
      return s.outcome;
    };`,
});

test('sin sesión → 401; sin membresía → 403; fallo interno → 500', async () => {
  state.outcome = 'UNAUTHENTICATED';
  assert.equal((await getPurchaseActor()).status, 401);
  state.outcome = 'FORBIDDEN';
  assert.equal((await getPurchaseActor()).status, 403);
  state.outcome = new Error('db down');
  const original = console.error; console.error = () => {};
  try { assert.equal((await getPurchaseActor()).status, 500); } finally { console.error = original; }
});

test('seller lee pero no administra; el actor viene del módulo central', async () => {
  state.calls = [];
  state.outcome = { userId: 'seller-a', organizationId: 'org-a', role: 'SELLER', storeId: 'store-a' };
  assert.deepEqual((await getPurchaseActor()).actor, { userId: 'seller-a', organizationId: 'org-a', role: 'SELLER' });
  assert.equal((await getPurchaseActor(true)).status, 403);
  assert.deepEqual(state.calls, [{}, { roles: ['ADMIN'] }]);
  state.outcome = { userId: 'admin-a', organizationId: 'org-a', role: 'ADMIN', storeId: null };
  assert.deepEqual((await getPurchaseActor(true)).actor, { userId: 'admin-a', organizationId: 'org-a', role: 'ADMIN' });
});
