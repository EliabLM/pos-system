import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from '../../../test/load-with-mocks.mjs';

const state = {};
globalThis.__actorTest = state;

const { getActor, requireActor, requireOnboardingUser, requireSessionUserId, actorErrorResponse, ActorError, blockedMembershipReason } = await loadWithMocks('src/lib/auth/actor.ts', {
  'next/headers': 'export const headers = async () => new Headers(globalThis.__actorTest.token ? { cookie: "better-auth.session_token=" + globalThis.__actorTest.token } : {});',
  '@/generated/prisma': 'export const MembershipRole = { ADMIN: "ADMIN", SELLER: "SELLER" }; export const MembershipStatus = { ACTIVE: "ACTIVE", REVOKED: "REVOKED" };',
  // Better Auth: getSession reads the session row by the cookie token (null if
  // missing, expired, signed out or revoked in the database).
  './better-auth': `export const auth = { api: { getSession: async ({ headers }) => {
    const s = globalThis.__actorTest;
    if (s.sessionError) throw s.sessionError;
    if (!headers.get('cookie')) return null;
    return s.session
      ? { session: { userId: s.session.userId, activeOrganizationId: s.session.activeOrganizationId ?? null }, user: { id: s.session.userId } }
      : null;
  } } };`,
  '@/lib/db': `export const prisma = {
    user: { findFirst: async q => { globalThis.__actorTest.queries.push(['user', q]); return globalThis.__actorTest.user; } },
    // Queries filtering by an active organization get the active membership;
    // the onboarding check (any non-deleted membership) gets anyMembership.
    membership: { findFirst: async q => {
      const s = globalThis.__actorTest;
      s.queries.push(['membership', q]);
      return q.where.organization ? s.membership : (s.anyMembership !== undefined ? s.anyMembership : s.membership);
    } },
  };`,
});

function reset() {
  Object.assign(state, {
    token: 'signed-token',
    sessionError: null,
    session: { userId: 'user-a' },
    user: { id: 'user-a' },
    membership: { organizationId: 'org-a', role: 'SELLER', defaultStoreId: 'store-a' },
    anyMembership: undefined,
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

test('sin cookie o con sesión cerrada, expirada o revocada en BD: UNAUTHENTICATED sin consultar usuario', async () => {
  reset(); state.token = null;
  assert.equal(await codeOf(getActor()), 'UNAUTHENTICATED');
  reset(); state.session = null;
  assert.equal(await codeOf(getActor()), 'UNAUTHENTICATED');
  assert.equal(state.queries.length, 0);
});

test('un fallo de infraestructura al leer la sesión se propaga (no es "no autenticado")', async () => {
  reset(); state.sessionError = new Error('db down');
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

test('actor sale de la sesión y la membresía, nunca de la cookie ni del cliente', async () => {
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

test('organización desactivada con la sesión abierta: no puede crear otra en el onboarding', async () => {
  reset(); state.membership = null; state.anyMembership = { organizationId: 'org-off' };
  assert.equal(await codeOf(getActor()), 'FORBIDDEN');
  assert.equal(await codeOf(requireOnboardingUser()), 'FORBIDDEN');
  const onboardingQuery = state.queries.filter(([model]) => model === 'membership').at(-1)[1];
  assert.deepEqual(onboardingQuery.where, { userId: 'user-a', deletedAt: null });
});

test('organización activa de la sesión: el actor sale de la membresía en ESA organización', async () => {
  reset(); state.session.activeOrganizationId = 'org-a';
  assert.deepEqual(await getActor(), { userId: 'user-a', organizationId: 'org-a', role: 'SELLER', storeId: 'store-a' });
  const membershipQuery = state.queries.filter(([model]) => model === 'membership').at(-1)[1];
  assert.deepEqual(membershipQuery.where, {
    userId: 'user-a', organizationId: 'org-a', deletedAt: null, status: 'ACTIVE', organization: { isDeleted: false, isActive: true },
  });
});

test('organización activa sin membresía activa en ella (suspendida, borrada u otra org): FORBIDDEN', async () => {
  reset(); state.session.activeOrganizationId = 'org-b'; state.membership = null;
  assert.equal(await codeOf(getActor()), 'FORBIDDEN');
});

test('motivo del bloqueo: membresía suspendida en organización activa ≠ organización desactivada', async () => {
  reset(); state.membership = null;
  state.anyMembership = { organizationId: 'org-a', status: 'REVOKED', organization: { isActive: true, isDeleted: false } };
  assert.equal(await blockedMembershipReason(), 'membresia-suspendida');
  state.anyMembership = { organizationId: 'org-off', status: 'ACTIVE', organization: { isActive: false, isDeleted: false } };
  assert.equal(await blockedMembershipReason(), 'organizacion-desactivada');
  state.anyMembership = { organizationId: 'org-off', status: 'REVOKED', organization: { isActive: false, isDeleted: false } };
  assert.equal(await blockedMembershipReason(), 'organizacion-desactivada', 'la organización desactivada manda');
});
