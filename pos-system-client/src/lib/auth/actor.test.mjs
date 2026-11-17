import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from '../../../test/load-with-mocks.mjs';

const state = {};
globalThis.__actorTest = state;

const { getActor, requireActor, requireOnboardingUser, requireSessionUserId, actorErrorResponse, ActorError } = await loadWithMocks('src/lib/auth/actor.ts', {
  'next/headers': 'export const cookies = async () => ({ get: name => name === "auth-token" && globalThis.__actorTest.token ? { value: globalThis.__actorTest.token } : undefined });',
  '@/generated/prisma': 'export const MembershipRole = { ADMIN: "ADMIN", SELLER: "SELLER" }; export const MembershipStatus = { ACTIVE: "ACTIVE", REVOKED: "REVOKED" };',
  './types': 'export class AuthError extends Error { constructor(m) { super(m); this.name = "AuthError"; } }',
  './jwt': 'import { AuthError } from "./types"; export const verifyToken = async () => { const s = globalThis.__actorTest; if (s.tokenError === "auth") throw new AuthError("expired"); if (s.tokenError) throw s.tokenError; return s.payload; };',
  './session': 'export const validateSession = async () => globalThis.__actorTest.session;',
  '@/lib/db': `export const prisma = {
    user: { findFirst: async q => { globalThis.__actorTest.queries.push(['user', q]); return globalThis.__actorTest.user; } },
    membership: { findFirst: async q => { globalThis.__actorTest.queries.push(['membership', q]); return globalThis.__actorTest.membership; } },
  };`,
});

function reset() {
  Object.assign(state, {
    token: 'signed-token',
    tokenError: null,
    // Claims of the token are NOT a source of tenancy: they point to org-b on purpose.
    payload: { userId: 'user-a', organizationId: 'org-b', role: 'ADMIN' },
    session: { userId: 'user-a' },
    user: { id: 'user-a' },
    membership: { organizationId: 'org-a', role: 'SELLER', defaultStoreId: 'store-a' },
    queries: [],
  });
}

async function codeOf(promise) {
  try {
    await promise;
    return 'OK';
  } catch (error) {
    assert.ok(error instanceof ActorError, `ActorError esperado, recibido ${error}`);
    return error.code;
  }
}

test('sin cookie, token inválido o sesión revocada/ajena: UNAUTHENTICATED sin consultar usuario', async () => {
  reset(); state.token = null;
  assert.equal(await codeOf(getActor()), 'UNAUTHENTICATED');
  reset(); state.session = null;
  assert.equal(await codeOf(getActor()), 'UNAUTHENTICATED');
  reset(); state.session = { userId: 'user-b' };
  assert.equal(await codeOf(getActor()), 'UNAUTHENTICATED');
  assert.equal(state.queries.length, 0);
});

test('token expirado/inválido (AuthError) es no autenticado; otro error se propaga', async () => {
  reset(); state.tokenError = 'auth';
  assert.equal(await codeOf(getActor()), 'UNAUTHENTICATED');
  assert.equal(state.queries.length, 0);
  reset(); state.tokenError = new Error('db down');
  await assert.rejects(getActor(), /db down/);
});

test('usuario inactivo o eliminado: UNAUTHENTICATED', async () => {
  reset(); state.user = null;
  assert.equal(await codeOf(getActor()), 'UNAUTHENTICATED');
  assert.deepEqual(state.queries[0][1].where, { id: 'user-a', isDeleted: false, isActive: true });
});

test('sin membresía activa (o revocada, u org inactiva): FORBIDDEN', async () => {
  reset(); state.membership = null;
  assert.equal(await codeOf(getActor()), 'FORBIDDEN');
  assert.deepEqual(state.queries[1][1].where, {
    userId: 'user-a', deletedAt: null, status: 'ACTIVE', organization: { isDeleted: false, isActive: true },
  });
  reset(); state.membership.role = 'OWNER';
  assert.equal(await codeOf(getActor()), 'FORBIDDEN');
});

test('actor sale de la sesión y la membresía, nunca de los claims del token', async () => {
  reset();
  assert.deepEqual(await getActor(), { userId: 'user-a', organizationId: 'org-a', role: 'SELLER', storeId: 'store-a' });
});

test('requireActor aplica roles', async () => {
  reset();
  assert.equal(await codeOf(requireActor({ roles: ['ADMIN'] })), 'FORBIDDEN');
  assert.equal(await codeOf(requireActor()), 'OK');
  state.membership.role = 'ADMIN';
  assert.equal(await codeOf(requireActor({ roles: ['ADMIN'] })), 'OK');
});

test('actorErrorResponse: 401/403 tipados; otros errores no se enmascaran', () => {
  assert.equal(actorErrorResponse(new ActorError('UNAUTHENTICATED')).status, 401);
  assert.equal(actorErrorResponse(new ActorError('FORBIDDEN')).status, 403);
  assert.equal(actorErrorResponse(new Error('x')), null);
});

test('usuario sin membresía: no tiene ningún rol (ni ADMIN ni SELLER)', async () => {
  reset(); state.membership = null;
  assert.equal(await codeOf(requireActor()), 'FORBIDDEN');
  assert.equal(await codeOf(requireActor({ roles: ['ADMIN'] })), 'FORBIDDEN');
});

test('requireOnboardingUser: solo el usuario con sesión y SIN membresía activa', async () => {
  reset(); state.membership = null;
  assert.deepEqual(await requireOnboardingUser(), { userId: 'user-a' });
  reset();
  assert.equal(await codeOf(requireOnboardingUser()), 'FORBIDDEN', 'quien ya tiene organización no crea otra');
  reset(); state.token = null; state.membership = null;
  assert.equal(await codeOf(requireOnboardingUser()), 'UNAUTHENTICATED');
  reset(); state.user = null; state.membership = null;
  assert.equal(await codeOf(requireOnboardingUser()), 'UNAUTHENTICATED');
});

test('requireSessionUserId: id de la sesión, nunca de parámetros', async () => {
  reset();
  assert.equal(await requireSessionUserId(), 'user-a');
  reset(); state.session = null;
  assert.equal(await codeOf(requireSessionUserId()), 'UNAUTHENTICATED');
});
