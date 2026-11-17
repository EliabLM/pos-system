import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from '../../../test/load-with-mocks.mjs';

// Registro público (#11): crea SOLO el usuario. organizationId/storeId del
// formulario se ignoran: nadie se une a una organización existente desde aquí.
const state = { writes: [] };
globalThis.__registerTest = state;

const write = (model, method, result) => async (args = {}) => {
  globalThis.__registerTest.writes.push({ model, method, data: args.data });
  return result(args);
};
globalThis.__registerPrisma = {
  user: {
    findFirst: async () => null,
    create: write('user', 'create', ({ data }) => ({
      id: 'new-user', name: data.name, email: data.email, isActive: true, emailVerified: false, createdAt: new Date(0),
    })),
  },
  membership: { create: write('membership', 'create', () => ({})) },
  $transaction: async (fn) => fn(globalThis.__registerPrisma),
};

const { registerUser } = await loadWithMocks('src/actions/auth/register.ts', {
  'next/headers': `
    export const headers = async () => new Map();
    export const cookies = async () => ({ set: (name) => globalThis.__registerTest.writes.push({ model: 'cookie', method: 'set', data: name }) });`,
  '@/actions/utils': 'export const prisma = globalThis.__registerPrisma;',
  '@/lib/auth': `
    export class AuthError extends Error {}
    export const hashPassword = async () => 'hash';
    export const validateEmail = () => true;
    export const validatePasswordComplete = () => true;
    export const normalizeEmail = (email) => email.trim().toLowerCase();
    export const createSession = async ({ userId }) => { globalThis.__registerTest.writes.push({ model: 'session', method: 'create', data: userId }); return { id: 'session-1', token: 'token' }; };`,
});

function form(extra = {}) {
  const fd = new FormData();
  const fields = { name: 'Ana', email: 'Ana@Example.com', password: 'Secreta#2026', confirmPassword: 'Secreta#2026', ...extra };
  for (const [key, value] of Object.entries(fields)) fd.append(key, value);
  return fd;
}

test('registro: crea solo el usuario y va al onboarding, sin rol ni organización', async () => {
  state.writes = [];
  const result = await registerUser(form());
  assert.equal(result.status, 201);
  assert.equal(result.data.redirectTo, '/onboarding');
  assert.equal(result.data.user.role, null);
  assert.equal(result.data.user.organizationId, null);
  assert.equal(result.data.user.storeId, null);
  assert.deepEqual(state.writes.filter((w) => w.model === 'membership'), []);
  assert.equal(state.writes.filter((w) => w.model === 'user').length, 1);
});

test('registro: no se puede unir a una organización existente (organizationId/storeId se ignoran)', async () => {
  state.writes = [];
  const result = await registerUser(form({
    organizationId: '00000000-0000-4000-8000-0000000000b1',
    storeId: '00000000-0000-4000-8000-0000000000b2',
    role: 'ADMIN',
  }));
  assert.equal(result.status, 201);
  assert.deepEqual(state.writes.filter((w) => w.model === 'membership'), [], 'no crea membresía');
  const userCreate = state.writes.find((w) => w.model === 'user');
  assert.deepEqual(Object.keys(userCreate.data).sort(), [
    'email', 'emailVerified', 'isActive', 'isDeleted', 'name', 'passwordChangedAt', 'passwordHash',
  ]);
  assert.equal(result.data.user.organizationId, null);
  assert.equal(result.data.user.role, null);
  assert.equal(result.data.redirectTo, '/onboarding');
});
