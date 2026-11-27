import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadWithMocks } from './load-with-mocks.mjs';

// #19: el middleware solo mira si existe la cookie de sesión de Better Auth
// (sin BD ni claims). Onboarding, rol y sesión real los decide el servidor
// (layouts y getActor()). #11: no publica la identidad en cabeceras x-user-*.
const { middleware } = await loadWithMocks('src/middleware.ts', {
  'next/server': `
    const response = (kind, extra = {}) => ({ kind, headers: new Headers(), cookies: { delete() {} }, ...extra });
    export const NextResponse = {
      next: (init) => response('next', { init }),
      redirect: (url) => response('redirect', { url: String(url) }),
    };`,
});

function request(pathname, cookie) {
  const url = new URL(pathname, 'http://localhost:3000');
  const headers = new Headers({ 'x-user-id': 'spoofed', 'x-organization-id': 'org-b' });
  if (cookie) headers.set('cookie', cookie);
  return { url: url.toString(), nextUrl: url, headers };
}

const SESSION = 'better-auth.session_token=abc.signature';

test('middleware: con cookie de sesión deja pasar sin añadir cabeceras x-user-* ni reenviar las del cliente', async () => {
  const res = await middleware(request('/dashboard/sales', SESSION));
  assert.equal(res.kind, 'next');
  assert.equal(res.init, undefined, 'no reescribe cabeceras de la petición');
  const leaked = [...res.headers.keys()].filter((h) => /^x-(user|organization|store)-/.test(h));
  assert.deepEqual(leaked, []);
});

test('middleware: acepta la cookie con prefijo __Secure- (HTTPS)', async () => {
  const res = await middleware(request('/dashboard', `__Secure-${SESSION}`));
  assert.equal(res.kind, 'next');
});

test('middleware: sin cookie, las rutas protegidas redirigen al login con la ruta pedida', async () => {
  for (const path of ['/', '/dashboard/reports', '/onboarding']) {
    const res = await middleware(request(path));
    assert.equal(res.kind, 'redirect', path);
    assert.equal(new URL(res.url).pathname, '/auth/login');
    assert.equal(new URL(res.url).searchParams.get('redirect'), path);
  }
  const old = await middleware(request('/dashboard', 'auth-token=jwt-viejo'));
  assert.equal(old.kind, 'redirect', 'la cookie del JWT anterior ya no cuenta');
});

test('middleware: login, registro y /api/auth/* son públicos', async () => {
  for (const path of ['/auth/login', '/auth/register', '/api/auth/sign-in/email', '/api/auth/get-session']) {
    assert.equal((await middleware(request(path))).kind, 'next', path);
  }
});

test('lib/auth/server.ts (lectura de cabeceras x-user-*) ya no existe', () => {
  assert.equal(existsSync(new URL('../src/lib/auth/server.ts', import.meta.url)), false);
});

test('middleware: el enlace de invitación (#20) se abre sin sesión; la página decide qué mostrar', async () => {
  const res = await middleware(request('/invitacion/00000000-0000-4000-8000-000000000001'));
  assert.equal(res.kind, 'next');
});
