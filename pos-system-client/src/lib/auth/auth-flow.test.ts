import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { buildAuthOptions, type SignInDenial } from './auth-options';
import { authErrorMessage, INVALID_CREDENTIALS_MESSAGE } from './auth-messages';

// Real Better Auth handler with our options over an in-memory database: the
// same HTTP endpoints the login, register and logout forms call.
const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'Secreta#2026';
const MAX_ATTEMPTS = 5;

type Row = Record<string, unknown>;
interface MemoryDb { [model: string]: Row[] }

function setup(denials: Record<string, SignInDenial> = {}) {
  const db: MemoryDb = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth(
    buildAuthOptions({
      database: memoryAdapter(db),
      secret: 'test-secret-with-at-least-32-characters!!',
      baseURL: BASE_URL,
      secureCookies: false,
      signInMaxAttempts: MAX_ATTEMPTS,
      generateId: 'uuid',
      canSignIn: async (userId) => denials[userId] ?? null,
    }),
  );
  return { db, auth };
}

let ipCounter = 0;
/** Each test gets its own client IP: the rate-limit store is per process. */
const nextIp = () => `10.0.0.${++ipCounter}`;

async function call(
  auth: ReturnType<typeof setup>['auth'],
  path: string,
  { body, cookie, ip = '10.9.9.9', method = 'POST' }: { body?: unknown; cookie?: string; ip?: string; method?: string } = {},
) {
  const headers = new Headers({ origin: BASE_URL, 'x-forwarded-for': ip });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  const res = await auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown> | null) : null;
  const setCookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { status: res.status, json, cookie: setCookie };
}

const signUp = (auth: ReturnType<typeof setup>['auth'], email: string, ip = nextIp()) =>
  call(auth, '/sign-up/email', { body: { name: 'Dueña', email, password: PASSWORD }, ip });

const sessionUser = async (auth: ReturnType<typeof setup>['auth'], cookie: string) =>
  (await call(auth, '/get-session', { method: 'GET', cookie })).json;

test('registro: crea el usuario, su sesión y la cookie', async () => {
  const { db, auth } = setup();
  const res = await signUp(auth, 'duena@pos.test');
  assert.equal(res.status, 200);
  assert.match(res.cookie, /session_token=/);
  assert.equal(db.user.length, 1);
  assert.equal(db.session.length, 1);
  assert.equal((await sessionUser(auth, res.cookie))?.user && 'ok', 'ok');
});

test('cerrar sesión borra la sesión: la cookie anterior ya no autentica', async () => {
  const { db, auth } = setup();
  const { cookie } = await signUp(auth, 'logout@pos.test');
  assert.equal((await call(auth, '/sign-out', { cookie, body: {} })).status, 200);
  assert.equal(db.session.length, 0);
  assert.equal(await sessionUser(auth, cookie), null);
});

test('revocar la sesión en BD: la siguiente petición no está autenticada', async () => {
  const { db, auth } = setup();
  const { cookie } = await signUp(auth, 'revocada@pos.test');
  db.session.length = 0;
  assert.equal(await sessionUser(auth, cookie), null);
});

test('login fallido: cuenta inexistente y contraseña errónea dan el mismo error y el mismo mensaje', async () => {
  const { auth } = setup();
  await signUp(auth, 'existe@pos.test');
  const ip = nextIp();
  const wrongPassword = await call(auth, '/sign-in/email', { body: { email: 'existe@pos.test', password: 'Otra#Clave2026' }, ip });
  const unknownUser = await call(auth, '/sign-in/email', { body: { email: 'nadie@pos.test', password: PASSWORD }, ip });
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.deepEqual(wrongPassword.json, unknownUser.json);
  assert.equal(authErrorMessage({ status: 401, ...wrongPassword.json }), INVALID_CREDENTIALS_MESSAGE);
  assert.equal(authErrorMessage({ status: 401, ...unknownUser.json }), INVALID_CREDENTIALS_MESSAGE);
  assert.equal(wrongPassword.cookie, '');
});

test(`tras ${MAX_ATTEMPTS} intentos desde la misma IP el login se limita, también con la contraseña correcta`, async () => {
  const { auth } = setup();
  await signUp(auth, 'limite@pos.test');
  const ip = nextIp();
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const email = i % 2 ? 'nadie@pos.test' : 'limite@pos.test';
    const res = await call(auth, '/sign-in/email', { body: { email, password: 'Mala#Clave2026' }, ip });
    assert.equal(res.status, 401, `intento ${i + 1}`);
  }
  const blocked = await call(auth, '/sign-in/email', { body: { email: 'limite@pos.test', password: PASSWORD }, ip });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.cookie, '');
  const blockedUnknown = await call(auth, '/sign-in/email', { body: { email: 'nadie@pos.test', password: PASSWORD }, ip });
  assert.equal(blockedUnknown.status, 429, 'el bloqueo no distingue cuentas');
  assert.match(authErrorMessage({ status: 429 }), /Demasiados intentos/);

  const otherIp = await call(auth, '/sign-in/email', { body: { email: 'limite@pos.test', password: PASSWORD }, ip: nextIp() });
  assert.equal(otherIp.status, 200);
});

test('canSignIn deniega: usuario eliminado = mismo mensaje genérico; desactivado = su mensaje y sin sesión', async () => {
  const denials: Record<string, SignInDenial> = {};
  const { db, auth } = setup(denials);
  await signUp(auth, 'baja@pos.test');
  const userId = String(db.user[0].id);
  db.session.length = 0;

  denials[userId] = { status: 'UNAUTHORIZED', message: INVALID_CREDENTIALS_MESSAGE };
  const deleted = await call(auth, '/sign-in/email', { body: { email: 'baja@pos.test', password: PASSWORD }, ip: nextIp() });
  assert.equal(deleted.status, 401);
  assert.equal(authErrorMessage({ status: 401, ...deleted.json }), INVALID_CREDENTIALS_MESSAGE);

  denials[userId] = { status: 'FORBIDDEN', message: 'Su cuenta ha sido desactivada. Por favor contacte a soporte' };
  const inactive = await call(auth, '/sign-in/email', { body: { email: 'baja@pos.test', password: PASSWORD }, ip: nextIp() });
  assert.equal(inactive.status, 403);
  assert.equal(authErrorMessage({ status: 403, ...inactive.json }), 'Su cuenta ha sido desactivada. Por favor contacte a soporte');
  assert.equal(db.session.length, 0);
});

test('una contraseña con hash bcrypt (usuarios existentes y seed) inicia sesión', async () => {
  const { db, auth } = setup();
  db.user.push({ id: crypto.randomUUID(), name: 'Seed', email: 'seed@pos.test', emailVerified: false, isActive: true, isDeleted: false, createdAt: new Date(), updatedAt: new Date() });
  db.account.push({
    id: crypto.randomUUID(), userId: db.user[0].id, providerId: 'credential', accountId: db.user[0].id,
    password: await bcrypt.hash('Admin123!', 12), createdAt: new Date(), updatedAt: new Date(),
  });
  const res = await call(auth, '/sign-in/email', { body: { email: 'seed@pos.test', password: 'Admin123!' }, ip: nextIp() });
  assert.equal(res.status, 200);
  assert.match(res.cookie, /session_token=/);
});

test('registro: valida nombre, correo y fuerza de la contraseña; ignora campos internos', async () => {
  const { db, auth } = setup();
  const weak = await call(auth, '/sign-up/email', { body: { name: 'A', email: 'a@pos.test', password: 'password1' }, ip: nextIp() });
  assert.equal(weak.status, 400);
  assert.match(authErrorMessage({ status: 400, ...weak.json }), /contraseña/i);
  const noName = await call(auth, '/sign-up/email', { body: { name: ' ', email: 'b@pos.test', password: PASSWORD }, ip: nextIp() });
  assert.equal(authErrorMessage({ status: 400, ...noName.json }), 'El nombre es requerido');
  const disposable = await call(auth, '/sign-up/email', { body: { name: 'C', email: 'c@mailinator.com', password: PASSWORD }, ip: nextIp() });
  assert.equal(disposable.status, 400);
  assert.equal(db.user.length, 0);

  const sneaky = await call(auth, '/sign-up/email', {
    body: { name: 'D', email: 'd@pos.test', password: PASSWORD, isActive: false, isDeleted: true, organizationId: 'org-b', role: 'ADMIN' },
    ip: nextIp(),
  });
  assert.equal(sneaky.status, 200);
  assert.equal(db.user.length, 1);
  assert.equal(db.user[0].isActive, true);
  assert.equal(db.user[0].isDeleted, false);
  assert.equal('organizationId' in db.user[0] || 'role' in db.user[0], false);

  await signUp(auth, 'repetido@pos.test');
  const dup = await signUp(auth, 'repetido@pos.test');
  assert.equal(authErrorMessage({ status: dup.status, ...dup.json }), 'Ya existe un usuario con este correo electrónico');
});
