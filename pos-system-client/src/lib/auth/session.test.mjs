import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from '../../../test/load-with-mocks.mjs';

// #11: un usuario sin membresía no tiene rol. El JWT de su sesión lleva
// role null (antes ADMIN), además de organización y tienda null.
const state = {};
globalThis.__sessionTest = state;

const { createSession } = await loadWithMocks('src/lib/auth/session.ts', {
  '@/actions/utils': `
    const s = () => globalThis.__sessionTest;
    export const getActiveMembership = async () => s().membership;
    export const prisma = {
      user: {
        findUnique: async () => ({ id: 'user-a', email: 'a@x.co', isActive: true, isDeleted: false }),
        update: async () => ({}),
      },
      session: {
        count: async () => 0,
        updateMany: async () => ({ count: 0 }),
        deleteMany: async () => ({ count: 0 }),
        findFirst: async () => null,
        update: async () => ({}),
        create: async ({ data }) => ({ id: 'session-1', ...data }),
      },
    };`,
  './jwt': `
    export const generateToken = async (payload) => { globalThis.__sessionTest.payload = payload; return 'token'; };
    export const verifyToken = async () => ({});`,
  './types': 'export class AuthError extends Error { constructor(code, message) { super(message); this.code = code; } } export const AuthErrorCode = {};',
});

test('createSession: sin membresía el token no lleva ningún rol', async () => {
  state.membership = null;
  await createSession({ userId: 'user-a' });
  assert.equal(state.payload.role, null);
  assert.equal(state.payload.organizationId, null);
  assert.equal(state.payload.storeId, null);
});

test('createSession: con membresía el token lleva el rol de esa membresía', async () => {
  state.membership = { role: 'SELLER', organizationId: 'org-a', defaultStoreId: 'store-a' };
  await createSession({ userId: 'user-a' });
  assert.equal(state.payload.role, 'SELLER');
  assert.equal(state.payload.organizationId, 'org-a');
  assert.equal(state.payload.storeId, 'store-a');
});
