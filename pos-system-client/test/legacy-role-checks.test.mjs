import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from './load-with-mocks.mjs';

// checkAdminRole/checkAdminOrSellerRole (módulos aún no migrados, #12–#15):
// el rol sale de la sesión, no del userId recibido; sin membresía no hay rol.
const state = { actor: null };
globalThis.__rolesTest = state;

const { checkAdminRole, checkAdminOrSellerRole } = await loadWithMocks('src/actions/utils.ts', {
  '@/generated/prisma': 'export const MembershipRole = { ADMIN: "ADMIN", SELLER: "SELLER" }; export const MembershipStatus = { ACTIVE: "ACTIVE" }; export const Prisma = { Decimal: class {} };',
  '@/lib/db': 'export const prisma = {};',
  '@/lib/auth/actor': `
    export const ACTIVE_MEMBERSHIP_WHERE = {}; export const ACTIVE_MEMBERSHIP_ORDER = {};
    export class ActorError extends Error { constructor(code) { super(code); this.code = code; } }
    export const requireActor = async ({ roles } = {}) => {
      const actor = globalThis.__rolesTest.actor;
      if (!actor) throw new ActorError('UNAUTHENTICATED');
      if (actor === 'NO_MEMBERSHIP') throw new ActorError('FORBIDDEN');
      if (roles && !roles.includes(actor.role)) throw new ActorError('FORBIDDEN');
      return actor;
    };`,
});

const ADMIN_A = { userId: 'admin-a', organizationId: 'org-a', role: 'ADMIN', storeId: null };
const SELLER_A = { userId: 'seller-a', organizationId: 'org-a', role: 'SELLER', storeId: null };

test('usuario sin membresía (recién registrado) no pasa ninguna comprobación', async () => {
  state.actor = 'NO_MEMBERSHIP';
  assert.equal(await checkAdminRole('user-x'), false);
  assert.equal(await checkAdminRole('user-x', 'org-a'), false);
  assert.equal(await checkAdminOrSellerRole('user-x'), false);
});

test('sin sesión no pasa aunque se envíe el userId de un admin', async () => {
  state.actor = null;
  assert.equal(await checkAdminRole('admin-a'), false);
});

test('el userId recibido debe ser el de la sesión', async () => {
  state.actor = ADMIN_A;
  assert.equal(await checkAdminRole('admin-a'), true);
  assert.equal(await checkAdminRole('admin-b'), false);
  assert.equal(await checkAdminRole(''), false);
});

test('la organización indicada debe ser la del actor', async () => {
  state.actor = ADMIN_A;
  assert.equal(await checkAdminRole('admin-a', 'org-a'), true);
  assert.equal(await checkAdminRole('admin-a', 'org-b'), false);
  assert.equal(await checkAdminOrSellerRole('admin-a', 'org-b'), false);
});

test('SELLER no es admin; sí pasa la comprobación admin-o-vendedor de su organización', async () => {
  state.actor = SELLER_A;
  assert.equal(await checkAdminRole('seller-a', 'org-a'), false);
  assert.equal(await checkAdminOrSellerRole('seller-a', 'org-a'), true);
});
