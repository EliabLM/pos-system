import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from '../../../test/load-with-mocks.mjs';

// Onboarding (#11): solo el usuario con sesión y SIN membresía crea SU
// organización y queda como ADMIN. Identidad y rol salen de la sesión.
const state = { session: null, memberInTx: false, writes: [], initial: [], catalog: [] };
globalThis.__orgTest = state;

const prisma = {
  organization: {
    findFirst: async () => null,
    create: async ({ data }) => { state.writes.push({ model: 'organization', data }); return { id: 'org-new', ...data }; },
  },
  membership: {
    findFirst: async () => (state.memberInTx ? { id: 'm-1' } : null),
    create: async ({ data }) => { state.writes.push({ model: 'membership', data }); return { id: 'm-new', ...data }; },
  },
  category: { createMany: async ({ data }) => { state.catalog.push({ model: 'category', data }); return { count: data.length }; } },
  brand: { createMany: async ({ data }) => { state.catalog.push({ model: 'brand', data }); return { count: data.length }; } },
  unitMeasure: { createMany: async ({ data }) => { state.catalog.push({ model: 'unitMeasure', data }); return { count: data.length }; } },
  $queryRaw: async () => [],
  $transaction: async (fn) => fn(prisma),
};
globalThis.__orgPrisma = prisma;

const initial = (name) => `export const ${name} = async (orgId, userId) => { globalThis.__orgTest.initial.push({ fn: '${name}', orgId, userId }); return { status: 201 }; };`;

const { createOrganization } = await loadWithMocks('src/actions/organization/organization.action.ts', {
  '@/generated/prisma': `
    export const Prisma = { PrismaClientKnownRequestError: class extends Error {} };
    export const MembershipRole = { ADMIN: 'ADMIN', SELLER: 'SELLER' };
    export const MembershipStatus = { ACTIVE: 'ACTIVE' };`,
  '@/lib/auth/actor': `
    export class ActorError extends Error { constructor(code) { super(code); this.code = code; this.status = code === 'UNAUTHENTICATED' ? 401 : 403; } }
    export const requireOnboardingUser = async () => {
      const s = globalThis.__orgTest.session;
      if (!s) throw new ActorError('UNAUTHENTICATED');
      if (s.hasMembership) throw new ActorError('FORBIDDEN');
      return { userId: s.userId };
    };
    export const actorErrorResponse = (error) => error instanceof ActorError ? { status: error.status, message: error.message, data: null } : null;`,
  '../utils': 'export const prisma = globalThis.__orgPrisma;',
  '../payment-methods': initial('createPaymentMethod'),
  '../system-config': 'export const setBusinessType = async () => ({ status: 201 });',
});

function reset(session) {
  Object.assign(state, { session, memberInTx: false, writes: [], initial: [], catalog: [] });
}

// Payload hostil: campos de tenancy/identidad que el servidor debe ignorar.
const orgInput = () => ({
  name: 'Mi Tienda', email: 'ana@example.com', nit: '900123', phone: null, address: 'Calle 1',
  city: 'Cartagena', department: 'Bolívar', taxId: null,
  id: 'org-b', organizationId: 'org-b', userId: 'admin-b', isActive: false, isDeleted: true, slug: 'x',
});

test('onboarding: el usuario sin membresía crea su organización y queda como ADMIN', async () => {
  reset({ userId: 'user-new' });
  const result = await createOrganization(orgInput(), 'shoe_store');
  assert.equal(result.status, 201);
  const org = state.writes.find((w) => w.model === 'organization');
  assert.equal(org.data.isActive, true);
  for (const key of ['id', 'organizationId', 'userId', 'isDeleted', 'slug']) assert.ok(!(key in org.data), `${key} no llega a Prisma`);
  const membership = state.writes.find((w) => w.model === 'membership');
  assert.deepEqual(
    { userId: membership.data.userId, organizationId: membership.data.organizationId, role: membership.data.role, status: membership.data.status },
    { userId: 'user-new', organizationId: 'org-new', role: 'ADMIN', status: 'ACTIVE' },
  );
  assert.ok(state.initial.length > 0 && state.initial.every((c) => c.orgId === 'org-new' && c.userId === 'user-new'));
  // Catálogo inicial (categorías, marcas, unidades) en la organización nueva.
  assert.deepEqual(state.catalog.map((c) => c.model), ['category', 'brand', 'unitMeasure']);
  for (const { data } of state.catalog) assert.ok(data.length > 0 && data.every((row) => row.organizationId === 'org-new'));
});

test('onboarding: quien ya pertenece a una organización no crea otra (403)', async () => {
  reset({ userId: 'seller-a', hasMembership: true });
  const result = await createOrganization(orgInput(), null);
  assert.equal(result.status, 403);
  assert.deepEqual(state.writes, []);
});

test('onboarding: sin sesión (401) no se crea nada', async () => {
  reset(null);
  const result = await createOrganization(orgInput(), null);
  assert.equal(result.status, 401);
  assert.deepEqual(state.writes, []);
});

test('onboarding: envío simultáneo (ya tiene membresía dentro de la tx) → 409 sin escribir', async () => {
  reset({ userId: 'user-new' });
  state.memberInTx = true;
  const result = await createOrganization(orgInput(), null);
  assert.equal(result.status, 409);
  assert.deepEqual(state.writes, []);
});

test('onboarding: datos inválidos → 400', async () => {
  reset({ userId: 'user-new' });
  assert.equal((await createOrganization({ ...orgInput(), name: '' }, null)).status, 400);
  assert.equal((await createOrganization(orgInput(), 'casino')).status, 400);
  assert.deepEqual(state.writes, []);
});
