import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from '../../../test/load-with-mocks.mjs';

// getCurrentUser: vista user + membresía activa que consumen el store y la UI.
// El usuario sale de la sesión (Better Auth, vía actor), nunca de parámetros.
const state = {};
globalThis.__currentUserTest = state;

const { getCurrentUser } = await loadWithMocks('src/actions/auth/getCurrentUser.ts', {
  '@/lib/auth/actor': `
    export class ActorError extends Error { constructor(code) { super(code === 'UNAUTHENTICATED' ? 'No autenticado' : 'Acción no autorizada'); this.code = code; this.status = code === 'UNAUTHENTICATED' ? 401 : 403; } }
    export const requireSessionUserId = async () => { const s = globalThis.__currentUserTest; if (!s.sessionUserId) throw new ActorError('UNAUTHENTICATED'); return s.sessionUserId; };
    export const actorErrorResponse = (e) => e instanceof ActorError ? { status: e.status, message: e.message, data: null } : null;`,
  '@/actions/utils': `export const prisma = { user: { findUnique: async (q) => { globalThis.__currentUserTest.query = q; return globalThis.__currentUserTest.user; } } };`,
});

const baseUser = (memberships) => ({
  id: 'user-a', name: 'Ana', email: 'a@x.co', image: null, isActive: true, emailVerified: false,
  lastLoginAt: null, createdAt: new Date(0), updatedAt: new Date(0), memberships,
});
const org = (isActive = true) => ({ id: 'org-a', name: 'Org A', phone: null, address: null, isActive, createdAt: new Date(0) });

test('sin sesión: 401 y no consulta usuarios', async () => {
  Object.assign(state, { sessionUserId: null, user: null, query: null });
  const res = await getCurrentUser();
  assert.equal(res.status, 401);
  assert.equal(state.query, null);
});

test('usuario sin membresía: sin rol, organización ni tienda', async () => {
  Object.assign(state, { sessionUserId: 'user-a', user: baseUser([]) });
  const res = await getCurrentUser();
  assert.equal(res.status, 200);
  assert.equal(state.query.where.id, 'user-a');
  assert.equal(res.data.user.role, null);
  assert.equal(res.data.user.organizationId, null);
  assert.equal(res.data.user.storeId, null);
  assert.equal('passwordHash' in res.data.user, false);
});

test('con membresía: rol, organización y tienda de esa membresía', async () => {
  Object.assign(state, {
    sessionUserId: 'user-a',
    user: baseUser([{ role: 'SELLER', organizationId: 'org-a', defaultStoreId: 'store-a', organization: org(), defaultStore: { id: 'store-a', isActive: true } }]),
  });
  const { data } = await getCurrentUser();
  assert.equal(data.user.role, 'SELLER');
  assert.equal(data.user.organizationId, 'org-a');
  assert.equal(data.user.storeId, 'store-a');
});

test('organización desactivada: 403', async () => {
  Object.assign(state, {
    sessionUserId: 'user-a',
    user: baseUser([{ role: 'ADMIN', organizationId: 'org-a', defaultStoreId: null, organization: org(false), defaultStore: null }]),
  });
  assert.equal((await getCurrentUser()).status, 403);
});
