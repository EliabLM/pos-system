import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from '../../../test/load-with-mocks.mjs';

// Gestión de usuarios (#11): solo el ADMIN y solo dentro de SU organización.
// Un usuario sin membresía no tiene ningún rol.
const ID = {
  adminA: '00000000-0000-4000-8000-0000000000a0',
  sellerA: '00000000-0000-4000-8000-0000000000a5',
  userB: '00000000-0000-4000-8000-0000000000b0',
  storeA: '00000000-0000-4000-8000-0000000000a1',
  storeB: '00000000-0000-4000-8000-0000000000b1',
};
const ADMIN_A = { userId: ID.adminA, organizationId: 'org-a', role: 'ADMIN', storeId: null };
const SELLER_A = { userId: ID.sellerA, organizationId: 'org-a', role: 'SELLER', storeId: ID.storeA };

const state = { actor: null, reads: [], writes: [], updateError: null };
globalThis.__userTest = state;

const userRow = (id, org) => ({
  id, name: id, email: `${id}@x.co`, isActive: true, isDeleted: false,
  memberships: [{ role: 'SELLER', organizationId: org, defaultStoreId: null, organization: { id: org }, defaultStore: null }],
});
const MEMBERS = { [ID.adminA]: 'org-a', [ID.sellerA]: 'org-a', [ID.userB]: 'org-b' };

const write = (model, method, result = () => ({})) => async (args = {}) => {
  state.writes.push({ model, method, data: args.data, where: args.where });
  return result(args);
};
const prisma = {
  user: {
    findFirst: async (args) => {
      state.reads.push({ model: 'user', where: args.where });
      const { id, email, memberships } = args.where;
      if (email) return null;
      const org = memberships?.some?.organizationId;
      return MEMBERS[id] && (!org || MEMBERS[id] === org) ? userRow(id, MEMBERS[id]) : null;
    },
    findMany: async (args) => { state.reads.push({ model: 'user', where: args.where }); return []; },
    findUniqueOrThrow: async ({ where }) => userRow(where.id, MEMBERS[where.id] ?? 'org-a'),
    create: write('user', 'create', ({ data }) => ({ id: 'new-user', ...data })),
    update: async (args) => {
      if (state.updateError) throw state.updateError;
      return write('user', 'update', ({ where }) => userRow(where.id, MEMBERS[where.id]))(args);
    },
    delete: write('user', 'delete'),
  },
  membership: {
    count: async ({ where }) => (MEMBERS[where.userId] && MEMBERS[where.userId] !== where.organizationId.not ? 1 : 0),
    findFirst: async () => null,
    create: write('membership', 'create'),
    updateMany: write('membership', 'updateMany'),
  },
  store: { findFirst: async ({ where }) => (where.id === ID.storeA && where.organizationId === 'org-a' ? { id: ID.storeA } : null) },
  sale: { count: async () => 0 },
  stockMovement: { count: async () => 0 },
  $transaction: async (arg) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)),
};
globalThis.__userPrisma = prisma;

const users = await loadWithMocks('src/actions/user/user.actions.ts', {
  '@/generated/prisma': `
    export const Prisma = { PrismaClientKnownRequestError: class extends Error { constructor(code) { super(code); this.code = code; } } };
    globalThis.__userPrismaNs = Prisma;
    export const MembershipRole = { ADMIN: 'ADMIN', SELLER: 'SELLER' };
    export const MembershipStatus = { ACTIVE: 'ACTIVE' };`,
  '@/lib/auth/actor': `
    export class ActorError extends Error { constructor(code) { super(code); this.code = code; this.status = code === 'UNAUTHENTICATED' ? 401 : 403; } }
    export const requireActor = async (options = {}) => {
      const actor = globalThis.__userTest.actor;
      if (!actor) throw new ActorError('UNAUTHENTICATED');
      if (actor === 'NO_MEMBERSHIP') throw new ActorError('FORBIDDEN');
      if (options.roles && !options.roles.includes(actor.role)) throw new ActorError('FORBIDDEN');
      return actor;
    };
    export const actorErrorResponse = (error) => error instanceof ActorError ? { status: error.status, message: error.message, data: null } : null;`,
  '../utils': 'export const prisma = globalThis.__userPrisma;',
  bcrypt: 'export default { hash: async () => "hash" };',
});

function reset(actor) {
  Object.assign(state, { actor, reads: [], writes: [], updateError: null });
}

const foreign = { organizationId: 'org-b', orgId: 'org-b', userId: ID.userB };
const newUser = () => ({ name: 'Vendedor', email: 'v@x.co', password: 'Secreta#2026', role: 'SELLER', storeId: ID.storeA, ...foreign });

/** Acciones de administración con un usuario de la organización B como objetivo. */
const adminActions = {
  getUsers: () => users.getUsers(),
  getUsersByRole: () => users.getUsersByRole('SELLER'),
  createUser: () => users.createUser(newUser()),
  updateUser: () => users.updateUser(ID.userB, { name: 'x', ...foreign }),
  updateUserRole: () => users.updateUserRole(ID.userB, 'ADMIN'),
  toggleUserStatus: () => users.toggleUserStatus(ID.userB, false),
  softDeleteUser: () => users.softDeleteUser(ID.userB),
  restoreUser: () => users.restoreUser(ID.userB),
  deleteUser: () => users.deleteUser(ID.userB),
};

test('usuario sin membresía (recién registrado): 403 en toda la gestión de usuarios, sin tocar la BD', async () => {
  for (const [name, run] of Object.entries({ ...adminActions, getUserById: () => users.getUserById(ID.userB) })) {
    reset('NO_MEMBERSHIP');
    assert.equal((await run()).status, 403, name);
    assert.deepEqual(state.writes, [], name);
    assert.deepEqual(state.reads, [], name);
  }
});

test('sin sesión: 401', async () => {
  reset(null);
  assert.equal((await users.getUsers()).status, 401);
});

test('SELLER: 403 en las acciones de administración', async () => {
  for (const [name, run] of Object.entries(adminActions)) {
    reset(SELLER_A);
    assert.equal((await run()).status, 403, name);
    assert.deepEqual(state.writes, [], name);
  }
});

test('ADMIN de A: un usuario de B es inexistente (404) y no se escribe nada', async () => {
  for (const name of ['updateUser', 'updateUserRole', 'toggleUserStatus', 'softDeleteUser', 'restoreUser', 'deleteUser']) {
    reset(ADMIN_A);
    assert.equal((await adminActions[name]()).status, 404, name);
    assert.deepEqual(state.writes, [], name);
  }
  reset(ADMIN_A);
  assert.equal((await users.getUserById(ID.userB)).status, 404);
});

test('ADMIN de A: listados filtrados por su organización', async () => {
  reset(ADMIN_A);
  await users.getUsers({ search: 'x' });
  await users.getUsersByRole('SELLER');
  const lists = state.reads.filter((r) => r.where.memberships);
  assert.equal(lists.length, 2);
  for (const r of lists) assert.equal(r.where.memberships.some.organizationId, 'org-a');
});

test('ADMIN de A: crea vendedores solo en su organización (ignora organizationId del cliente)', async () => {
  reset(ADMIN_A);
  const result = await users.createUser(newUser());
  assert.equal(result.status, 201);
  const membership = state.writes.find((w) => w.model === 'membership' && w.method === 'create');
  assert.equal(membership.data.organizationId, 'org-a');
  assert.equal(membership.data.invitedBy, ID.adminA);
  const user = state.writes.find((w) => w.model === 'user' && w.method === 'create');
  assert.ok(!('organizationId' in user.data) && !('userId' in user.data));

  reset(ADMIN_A);
  assert.equal((await users.createUser({ ...newUser(), storeId: ID.storeB })).status, 400, 'tienda de otra organización');
  assert.deepEqual(state.writes, []);
});

test('ADMIN de A: gestiona usuarios de su organización y no puede quitarse el rol a sí mismo', async () => {
  reset(ADMIN_A);
  assert.equal((await users.updateUserRole(ID.sellerA, 'ADMIN')).status, 200);
  const update = state.writes.find((w) => w.model === 'membership' && w.method === 'updateMany');
  assert.equal(update.where.organizationId, 'org-a');

  reset(ADMIN_A);
  assert.equal((await users.updateUserRole(ID.adminA, 'SELLER')).status, 400);
  assert.equal((await users.toggleUserStatus(ID.adminA, false)).status, 400);
  assert.equal((await users.softDeleteUser(ID.adminA)).status, 400);
  assert.deepEqual(state.writes, []);
});

test('SELLER: solo se ve a sí mismo', async () => {
  reset(SELLER_A);
  assert.equal((await users.getUserById(ID.sellerA)).status, 200);
  assert.equal((await users.getUserById(ID.adminA)).status, 404);
});

test('ADMIN: crear o editar usuarios exige la misma política de contraseña que el registro', async () => {
  for (const weak of ['password1', 'Corta#1', 'sinmayuscula#2026', 'SinEspecial2026']) {
    reset(ADMIN_A);
    assert.equal((await users.createUser({ ...newUser(), password: weak })).status, 400, `create: ${weak}`);
    assert.equal((await users.updateUser(ID.sellerA, { password: weak })).status, 400, `update: ${weak}`);
    assert.deepEqual(state.writes, [], weak);
  }
  reset(ADMIN_A);
  assert.equal((await users.updateUser(ID.sellerA, { password: 'Otra#Clave2026' })).status, 200);
});

test('ADMIN: restaurar un usuario cuyo email ya se reutilizó → 409 (no 500)', async () => {
  reset(ADMIN_A);
  state.updateError = new globalThis.__userPrismaNs.PrismaClientKnownRequestError('P2002');
  assert.equal((await users.restoreUser(ID.sellerA)).status, 409);
});
