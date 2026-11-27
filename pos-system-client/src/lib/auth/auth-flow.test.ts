import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { assertAuthEnv, buildAuthOptions, secureCookiesFromEnv, type SignInDenial } from './auth-options';
import { authErrorMessage, INVALID_CREDENTIALS_MESSAGE } from './auth-messages';

// Real Better Auth handler with our options over an in-memory database: the
// same HTTP endpoints the login, register and logout forms call.
const BASE_URL = 'http://localhost:3000';
const PASSWORD = 'Secreta#2026';
const MAX_ATTEMPTS = 5;

type Row = Record<string, unknown>;
interface MemoryDb { [model: string]: Row[] }

function setup(
  denials: Record<string, SignInDenial> = {},
  opts: {
    baseURL?: string;
    secureCookies?: boolean | undefined;
    acceptDenials?: Record<string, SignInDenial>;
  } = {},
) {
  const baseURL = opts.baseURL ?? BASE_URL;
  // An explicit undefined must reach Better Auth (it then decides Secure itself).
  const secureCookies = 'secureCookies' in opts ? opts.secureCookies : false;
  const db: MemoryDb = {
    user: [], session: [], account: [], verification: [], organization: [], membership: [], invitation: [],
  };
  const auth = betterAuth(
    buildAuthOptions({
      database: memoryAdapter(db),
      secret: 'test-secret-with-at-least-32-characters!!',
      baseURL,
      secureCookies,
      signInMaxAttempts: MAX_ATTEMPTS,
      generateId: 'uuid',
      canSignIn: async (userId) => denials[userId] ?? null,
      // Same rule as production: the oldest membership of the user.
      activeOrganizationFor: async (userId) =>
        (db.membership.find((m) => m.userId === userId)?.organizationId as string | undefined) ?? null,
      canAcceptInvitation: async ({ userId }) => opts.acceptDenials?.[userId] ?? null,
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

test('cookie Secure: sin HTTPS_ENABLED explícito vale el criterio de Better Auth (URL https → Secure)', async () => {
  assert.equal(secureCookiesFromEnv(undefined), undefined);
  assert.equal(secureCookiesFromEnv(''), undefined);
  assert.equal(secureCookiesFromEnv('true'), true);
  assert.equal(secureCookiesFromEnv('false'), false);

  const httpsUrl = 'https://pos.example.com';
  const { auth } = setup({}, { baseURL: httpsUrl, secureCookies: secureCookiesFromEnv(undefined) });
  const res = await auth.handler(new Request(`${httpsUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { origin: httpsUrl, 'content-type': 'application/json', 'x-real-ip': nextIp() },
    body: JSON.stringify({ name: 'Segura', email: 'segura@pos.test', password: PASSWORD }),
  }));
  assert.equal(res.status, 200);
  const sessionCookie = res.headers.getSetCookie().find((c) => c.includes('session_token='));
  assert.match(sessionCookie ?? '', /^__Secure-better-auth\.session_token=/);
  assert.match(sessionCookie ?? '', /;\s*Secure/i);
  assert.match(sessionCookie ?? '', /;\s*HttpOnly/i);
});

test('IP del cliente: x-real-ip (un solo valor, lo pone Traefik) manda sobre un x-forwarded-for con varias IP', async () => {
  const { auth } = setup();
  await signUp(auth, 'ip@pos.test');
  const attempt = (realIp: string) => auth.handler(new Request(`${BASE_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: BASE_URL, 'content-type': 'application/json', 'x-real-ip': realIp, 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    body: JSON.stringify({ email: 'ip@pos.test', password: 'Mala#Clave2026' }),
  }));
  const blocked = nextIp();
  for (let i = 0; i < MAX_ATTEMPTS; i++) assert.equal((await attempt(blocked)).status, 401);
  assert.equal((await attempt(blocked)).status, 429);
  assert.equal((await attempt(nextIp())).status, 401, 'otra IP real no comparte el contador');
});

test('producción: sin BETTER_AUTH_URL o sin BETTER_AUTH_SECRET la app no arranca (el build sí)', () => {
  const secret = 'x'.repeat(32);
  assert.throws(() => assertAuthEnv({ NODE_ENV: 'production', BETTER_AUTH_SECRET: secret }), /BETTER_AUTH_URL/);
  assert.throws(() => assertAuthEnv({ NODE_ENV: 'production', BETTER_AUTH_URL: 'https://pos.example.com' }), /BETTER_AUTH_SECRET/);
  assert.throws(() => assertAuthEnv({ NODE_ENV: 'production', BETTER_AUTH_URL: 'https://pos.example.com', BETTER_AUTH_SECRET: 'corto' }), /BETTER_AUTH_SECRET/);
  assert.doesNotThrow(() => assertAuthEnv({ NODE_ENV: 'production', BETTER_AUTH_URL: 'https://pos.example.com', BETTER_AUTH_SECRET: secret }));
  assert.doesNotThrow(() => assertAuthEnv({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' }));
  assert.doesNotThrow(() => assertAuthEnv({ NODE_ENV: 'development' }));
});

// ---------------------------------------------------------------------------
// Organizations, roles and invitations (#20)
// ---------------------------------------------------------------------------

type Auth = ReturnType<typeof setup>['auth'];

/** An organization with its ADMIN signed in (the onboarding creates both). */
async function orgWithAdmin(db: MemoryDb, auth: Auth, label: string) {
  const organizationId = crypto.randomUUID();
  db.organization.push({ id: organizationId, name: `Tienda ${label}`, slug: `tienda-${label}`, createdAt: new Date() });
  const admin = await signUp(auth, `admin-${label}@pos.test`);
  const adminId = String(db.user.find((u) => u.email === `admin-${label}@pos.test`)?.id);
  db.membership.push({ id: crypto.randomUUID(), organizationId, userId: adminId, role: 'ADMIN', createdAt: new Date() });
  // Signs in again so the session gets its active organization.
  const signIn = await call(auth, '/sign-in/email', { body: { email: `admin-${label}@pos.test`, password: PASSWORD }, ip: nextIp() });
  assert.equal(signIn.status, 200);
  return { organizationId, adminId, cookie: signIn.cookie || admin.cookie };
}

/** Server-side call (as the invitation server actions do), with the cookie of the caller. */
const invite = (auth: Auth, cookie: string, email: string, role: 'ADMIN' | 'SELLER' = 'SELLER') =>
  auth.api.createInvitation({ headers: new Headers({ cookie }), body: { email, role } });

const accept = (auth: Auth, cookie: string, invitationId: string) =>
  call(auth, '/organization/accept-invitation', { cookie, body: { invitationId } });

test('sesión nueva: la organización activa es la de su membresía', async () => {
  const { db, auth } = setup();
  const { organizationId, cookie } = await orgWithAdmin(db, auth, 'activa');
  const session = (await sessionUser(auth, cookie)) as { session: { activeOrganizationId: string | null } };
  assert.equal(session.session.activeOrganizationId, organizationId);
  const fresh = await signUp(auth, 'sin-org@pos.test');
  const freshSession = (await sessionUser(auth, fresh.cookie)) as { session: { activeOrganizationId: string | null } };
  assert.equal(freshSession.session.activeOrganizationId ?? null, null);
});

test('el ADMIN invita, el vendedor acepta con su correo y entra como SELLER con esa organización activa', async () => {
  const { db, auth } = setup();
  const { organizationId, adminId, cookie: adminCookie } = await orgWithAdmin(db, auth, 'invita');
  const invitation = await invite(auth, adminCookie, 'Vendedor@pos.test');
  assert.equal(invitation.status, 'pending');
  assert.equal(invitation.email, 'vendedor@pos.test');
  assert.equal(invitation.inviterId, adminId);
  const days = (new Date(invitation.expiresAt).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 6.9 && days <= 7, `caduca en 7 días (${days})`);

  const seller = await signUp(auth, 'vendedor@pos.test');
  const res = await accept(auth, seller.cookie, invitation.id);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const sellerId = db.user.find((u) => u.email === 'vendedor@pos.test')?.id;
  const member = db.membership.find((m) => m.userId === sellerId);
  assert.equal(member?.role, 'SELLER');
  assert.equal(member?.organizationId, organizationId);
  const session = (await sessionUser(auth, seller.cookie)) as { session: { activeOrganizationId: string } };
  assert.equal(session.session.activeOrganizationId, organizationId);
  assert.equal(db.invitation[0].status, 'accepted');
});

test('aceptar con otro correo falla y no crea membresía', async () => {
  const { db, auth } = setup();
  const { cookie } = await orgWithAdmin(db, auth, 'otro-correo');
  const invitation = await invite(auth, cookie, 'elegido@pos.test');
  const intruder = await signUp(auth, 'intruso@pos.test');
  const res = await accept(auth, intruder.cookie, invitation.id);
  assert.equal(res.status, 403);
  assert.equal(db.membership.length, 1);
  assert.equal(db.invitation[0].status, 'pending');
});

test('una invitación caducada o revocada no se puede aceptar', async () => {
  const { db, auth } = setup();
  const { cookie } = await orgWithAdmin(db, auth, 'caduca');
  const expired = await invite(auth, cookie, 'tarde@pos.test');
  const row = db.invitation.find((i) => i.id === expired.id);
  if (row) row.expiresAt = new Date(Date.now() - 1000);
  const late = await signUp(auth, 'tarde@pos.test');
  assert.equal((await accept(auth, late.cookie, expired.id)).status, 400);

  const revoked = await invite(auth, cookie, 'revocado@pos.test');
  await auth.api.cancelInvitation({ headers: new Headers({ cookie }), body: { invitationId: revoked.id } });
  const user = await signUp(auth, 'revocado@pos.test');
  assert.equal((await accept(auth, user.cookie, revoked.id)).status, 400);
  assert.equal(db.membership.length, 1, 'solo el ADMIN');
});

test('un SELLER no puede invitar', async () => {
  const { db, auth } = setup();
  const { cookie } = await orgWithAdmin(db, auth, 'seller-no');
  const invitation = await invite(auth, cookie, 'vende@pos.test');
  const seller = await signUp(auth, 'vende@pos.test');
  await accept(auth, seller.cookie, invitation.id);
  await assert.rejects(invite(auth, seller.cookie, 'otro@pos.test'), (error: { status?: string }) => error.status === 'FORBIDDEN');
  await assert.rejects(invite(auth, cookie, 'otro-admin@pos.test', 'ADMIN'), 'el ADMIN solo invita vendedores');
});

test('canAcceptInvitation deniega (ya pertenece a otra organización): 403 con su mensaje y sin membresía', async () => {
  const acceptDenials: Record<string, SignInDenial> = {};
  const { db, auth } = setup({}, { acceptDenials });
  const { cookie } = await orgWithAdmin(db, auth, 'dos-orgs');
  const invitation = await invite(auth, cookie, 'ocupado@pos.test');
  const user = await signUp(auth, 'ocupado@pos.test');
  const userId = String(db.user.find((u) => u.email === 'ocupado@pos.test')?.id);
  acceptDenials[userId] = { status: 'FORBIDDEN', message: 'Ya perteneces a una organización' };
  const res = await accept(auth, user.cookie, invitation.id);
  assert.equal(res.status, 403);
  assert.equal(authErrorMessage({ status: 403, ...res.json }), 'Ya perteneces a una organización');
  assert.equal(db.invitation[0].status, 'pending');
});

test('ninguna ruta HTTP permite unirse o cambiar de organización sin invitación', async () => {
  const { db, auth } = setup();
  const { organizationId, cookie: adminCookie } = await orgWithAdmin(db, auth, 'rutas');
  const outsider = await signUp(auth, 'fuera@pos.test');
  const outsiderId = String(db.user.find((u) => u.email === 'fuera@pos.test')?.id);
  const attempts: Array<[string, unknown, string]> = [
    ['/organization/create', { name: 'Mía', slug: 'mia' }, outsider.cookie],
    ['/organization/set-active', { organizationId }, outsider.cookie],
    ['/organization/update-member-role', { memberId: 'x', role: 'ADMIN', organizationId }, outsider.cookie],
    ['/organization/invite-member', { email: 'fuera@pos.test', role: 'SELLER', organizationId }, adminCookie],
    ['/organization/cancel-invitation', { invitationId: 'x' }, adminCookie],
    ['/organization/remove-member', { memberIdOrEmail: 'x', organizationId }, adminCookie],
    ['/organization/leave', { organizationId }, adminCookie],
    ['/organization/delete', { organizationId }, adminCookie],
    ['/organization/update', { data: { name: 'x' }, organizationId }, adminCookie],
  ];
  for (const [path, body, cookie] of attempts) {
    const res = await call(auth, path, { body, cookie });
    assert.equal(res.status, 404, path);
  }
  assert.equal(db.membership.filter((m) => m.userId === outsiderId).length, 0);
  assert.equal(db.organization.length, 1);
  assert.equal(db.invitation.length, 0);
});
