import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from '../../../test/load-with-mocks.mjs';

// Invitaciones (#20): solo el ADMIN invita, a SU organización y con rol SELLER.
// Better Auth (plugin organization) guarda la invitación; la organización y el
// rol salen del actor, nunca del cliente.
const INV = {
  own: '00000000-0000-4000-8000-0000000000e1',
  other: '00000000-0000-4000-8000-0000000000e2',
};
const ADMIN_A = { userId: 'admin-a', organizationId: 'org-a', role: 'ADMIN', storeId: null };
const SELLER_A = { userId: 'seller-a', organizationId: 'org-a', role: 'SELLER', storeId: null };

const state = { actor: null, authCalls: [], reads: [], authError: null };
globalThis.__invTest = state;

const { createInvitation, getPendingInvitations, cancelInvitation } = await loadWithMocks(
  'src/actions/invitation/invitation.actions.ts',
  {
    'next/headers': 'export const headers = async () => new Headers({ cookie: "better-auth.session_token=t" });',
    '@/lib/auth/actor': `
      export class ActorError extends Error { constructor(code) { super(code); this.code = code; this.status = code === 'UNAUTHENTICATED' ? 401 : 403; } }
      export const requireActor = async ({ roles } = {}) => {
        const a = globalThis.__invTest.actor;
        if (!a) throw new ActorError('UNAUTHENTICATED');
        if (roles && !roles.includes(a.role)) throw new ActorError('FORBIDDEN');
        return a;
      };
      export const actorErrorResponse = (e) => e instanceof ActorError ? { status: e.status, message: e.message, data: null } : null;`,
    '@/lib/auth/better-auth': `export const auth = { api: {
      createInvitation: async (args) => {
        const s = globalThis.__invTest; s.authCalls.push(['create', args]);
        if (s.authError) throw s.authError;
        return { id: '${INV.own}', email: args.body.email, role: 'SELLER', status: 'pending', expiresAt: new Date('2026-12-04T00:00:00Z'), organizationId: args.body.organizationId };
      },
      cancelInvitation: async (args) => { globalThis.__invTest.authCalls.push(['cancel', args]); return { id: args.body.invitationId, status: 'canceled' }; },
    } };`,
    '@/generated/prisma': `export const MembershipRole = { ADMIN: 'ADMIN', SELLER: 'SELLER' };`,
    '../utils': `export const prisma = { invitation: {
      findMany: async (q) => { globalThis.__invTest.reads.push(q); return []; },
      findFirst: async (q) => { globalThis.__invTest.reads.push(q); return q.where.id === '${INV.own}' && q.where.organizationId === 'org-a' ? { id: q.where.id } : null; },
    } };`,
  },
);

function reset(actor) {
  Object.assign(state, { actor, authCalls: [], reads: [], authError: null });
}

test('un SELLER no puede invitar, listar ni revocar invitaciones (403) y no llega a Better Auth', async () => {
  reset(SELLER_A);
  assert.equal((await createInvitation({ email: 'nuevo@pos.test' })).status, 403);
  assert.equal((await getPendingInvitations()).status, 403);
  assert.equal((await cancelInvitation(INV.own)).status, 403);
  assert.equal(state.authCalls.length, 0);
  reset(null);
  assert.equal((await createInvitation({ email: 'nuevo@pos.test' })).status, 401);
});

test('el ADMIN invita a SU organización con rol SELLER aunque el cliente pida otra cosa', async () => {
  reset(ADMIN_A);
  const res = await createInvitation({ email: ' Nuevo@POS.test ', role: 'ADMIN', organizationId: 'org-b' });
  assert.equal(res.status, 201, res.message);
  assert.deepEqual(res.data, { id: INV.own, email: 'nuevo@pos.test', expiresAt: new Date('2026-12-04T00:00:00Z') });
  const [, args] = state.authCalls[0];
  assert.deepEqual(args.body, { email: 'nuevo@pos.test', role: 'SELLER', organizationId: 'org-a' });
  assert.ok(args.headers.get('cookie'), 'Better Auth recibe la sesión del ADMIN');
});

test('correo inválido: 400 sin llamar a Better Auth', async () => {
  reset(ADMIN_A);
  assert.equal((await createInvitation({ email: 'no-es-correo' })).status, 400);
  assert.equal(state.authCalls.length, 0);
});

test('el correo ya es miembro de la organización: 409 con mensaje en español', async () => {
  reset(ADMIN_A);
  state.authError = Object.assign(new Error('User is already a member of this organization'), {
    body: { code: 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION' },
  });
  const res = await createInvitation({ email: 'seller@pos.test' });
  assert.equal(res.status, 409);
  assert.match(res.message, /ya pertenece/);
});

test('invitaciones pendientes: solo las vigentes de la organización del actor', async () => {
  reset(ADMIN_A);
  assert.equal((await getPendingInvitations()).status, 200);
  const { where } = state.reads[0];
  assert.equal(where.organizationId, 'org-a');
  assert.equal(where.status, 'pending');
  assert.ok(where.expiresAt.gt instanceof Date);
});

test('revocar: solo una invitación pendiente de su organización; otra = 404 sin tocar Better Auth', async () => {
  reset(ADMIN_A);
  assert.equal((await cancelInvitation(INV.other)).status, 404);
  assert.equal((await cancelInvitation('no-uuid')).status, 400);
  assert.equal(state.authCalls.length, 0);
  assert.equal((await cancelInvitation(INV.own)).status, 200);
  assert.deepEqual(state.authCalls[0][1].body, { invitationId: INV.own });
  assert.equal(state.reads.at(-1).where.status, 'pending');
});
