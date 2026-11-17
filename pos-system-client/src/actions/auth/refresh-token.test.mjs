import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from '../../../test/load-with-mocks.mjs';

// refreshToken: el usuario sale de la sesión de la cookie, la membresía se
// elige con el criterio de getActor() y el token anterior queda invalidado.
const state = {};
globalThis.__refreshTest = state;

function reset({ session = 'user-a' } = {}) {
  Object.assign(state, { session, cookie: 'old-token', set: [], created: [], invalidated: [], userQuery: null });
}

const { refreshToken } = await loadWithMocks('src/actions/auth/refreshToken.ts', {
  'next/headers': `
    const s = () => globalThis.__refreshTest;
    export const headers = async () => new Map();
    export const cookies = async () => ({
      get: (name) => (name === 'auth-token' && s().cookie ? { value: s().cookie } : undefined),
      set: (name, value) => { s().set.push(value); s().cookie = value; },
    });`,
  '@/actions/utils': `export const prisma = { user: { findFirst: async (q) => {
    globalThis.__refreshTest.userQuery = q;
    return { id: 'user-a', name: 'A', email: 'a@x.co', isActive: true, emailVerified: false, createdAt: new Date(0),
      memberships: [{ role: 'ADMIN', organizationId: 'org-a', defaultStoreId: null, organization: { id: 'org-a' }, defaultStore: null }] };
  } } };`,
  '@/lib/auth': `
    export const createSession = async ({ userId }) => { globalThis.__refreshTest.created.push(userId); return { id: 'session-new', token: 'new-token' }; };
    export const invalidateSession = async (token) => { globalThis.__refreshTest.invalidated.push(token); return true; };`,
  '@/lib/auth/types': 'export class AuthError extends Error {} export const AuthErrorCode = {};',
  '@/lib/auth/actor': `
    export const ACTIVE_MEMBERSHIP_WHERE = { marker: 'active-membership-where' };
    export const ACTIVE_MEMBERSHIP_ORDER = { marker: 'active-membership-order' };
    export class ActorError extends Error { constructor(code) { super(code); this.status = code === 'UNAUTHENTICATED' ? 401 : 403; } }
    export const requireSessionUserId = async () => { const id = globalThis.__refreshTest.session; if (!id) throw new ActorError('UNAUTHENTICATED'); return id; };
    export const actorErrorResponse = (e) => (e instanceof ActorError ? { status: e.status, message: e.message, data: null } : null);`,
});

test('refreshToken: emite sesión nueva e invalida la de la cookie actual', async () => {
  reset();
  const result = await refreshToken();
  assert.equal(result.status, 200);
  assert.deepEqual(state.created, ['user-a']);
  assert.deepEqual(state.set, ['new-token']);
  assert.deepEqual(state.invalidated, ['old-token'], 'el token viejo deja de valer');
});

test('refreshToken: la membresía se elige con el mismo criterio que getActor()', async () => {
  reset();
  await refreshToken();
  const memberships = state.userQuery.select.memberships;
  assert.deepEqual(memberships.where, { marker: 'active-membership-where' });
  assert.deepEqual(memberships.orderBy, { marker: 'active-membership-order' });
  assert.equal(state.userQuery.where.id, 'user-a');
});

test('refreshToken: sin sesión → 401, sin crear ni invalidar sesiones', async () => {
  reset({ session: null });
  const result = await refreshToken();
  assert.equal(result.status, 401);
  assert.deepEqual(state.created, []);
  assert.deepEqual(state.invalidated, []);
});
