import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from '../../../test/load-with-mocks.mjs';

// Logout: Better Auth borra la sesión de la cookie en BD (revocación real,
// cubierta en src/lib/auth/auth-flow.test.ts); la acción solo se la pasa.
const state = { calls: [] };
globalThis.__logoutTest = state;

const { logoutUser } = await loadWithMocks('src/actions/auth/logout.ts', {
  'next/headers': `export const headers = async () => new Headers({ cookie: 'better-auth.session_token=abc' });`,
  '@/lib/auth/better-auth': `export const auth = { api: { signOut: async (args) => {
    globalThis.__logoutTest.calls.push(args.headers.get('cookie'));
    if (globalThis.__logoutTest.fail) throw globalThis.__logoutTest.fail;
    return { success: true };
  } } };`,
});

test('logout: cierra en Better Auth la sesión de la cookie de la petición', async () => {
  state.calls = []; state.fail = null;
  const res = await logoutUser();
  assert.equal(res.status, 200);
  assert.deepEqual(state.calls, ['better-auth.session_token=abc']);
});

test('logout: si falla, responde 500 (la UI no da la sesión por cerrada)', async () => {
  state.calls = []; state.fail = new Error('db down');
  assert.equal((await logoutUser()).status, 500);
});
