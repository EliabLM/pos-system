import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadWithMocks } from './load-with-mocks.mjs';

// #11: el middleware ya no publica la identidad en cabeceras x-user-* (ni en
// la respuesta ni en la petición) y no existe el helper que las leía.
const state = { payload: null };
globalThis.__mwTest = state;

const { middleware } = await loadWithMocks('src/middleware.ts', {
  'next/server': `
    const response = (kind, extra = {}) => ({ kind, headers: new Headers(), cookies: { delete() {} }, ...extra });
    export const NextResponse = {
      next: (init) => response('next', { init }),
      redirect: (url) => response('redirect', { url: String(url) }),
    };`,
  jose: 'export const jwtVerify = async () => ({ payload: globalThis.__mwTest.payload });',
  '@/lib/rbac': 'export const hasRouteAccess = () => true; export const getUnauthorizedRedirect = () => "/dashboard";',
});

function request(pathname) {
  const url = new URL(pathname, 'http://localhost:3000');
  return {
    url: url.toString(),
    nextUrl: url,
    headers: new Headers({ 'x-user-id': 'spoofed', 'x-organization-id': 'org-b' }),
    cookies: { get: (name) => (name === 'auth-token' ? { value: 'signed' } : undefined) },
  };
}

test('middleware: con sesión válida no añade cabeceras x-user-* ni reenvía las del cliente', async () => {
  process.env.JWT_SECRET = 'test-secret';
  state.payload = { userId: 'user-a', email: 'a@x.co', role: 'ADMIN', organizationId: 'org-a', storeId: 'store-a' };
  const res = await middleware(request('/dashboard/sales'));
  assert.equal(res.kind, 'next');
  assert.equal(res.init, undefined, 'no reescribe cabeceras de la petición');
  const leaked = [...res.headers.keys()].filter((h) => /^x-(user|organization|store)-/.test(h));
  assert.deepEqual(leaked, []);
});

test('middleware: sin organización en el token, el dashboard redirige al onboarding', async () => {
  state.payload = { userId: 'user-new', email: 'n@x.co', role: 'ADMIN', organizationId: null };
  const res = await middleware(request('/dashboard'));
  assert.equal(res.kind, 'redirect');
  assert.match(res.url, /\/onboarding$/);
});

test('lib/auth/server.ts (lectura de cabeceras x-user-*) ya no existe', () => {
  assert.equal(existsSync(new URL('../src/lib/auth/server.ts', import.meta.url)), false);
});
