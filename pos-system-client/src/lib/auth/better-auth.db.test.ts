import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { PrismaClient } from '@/generated/prisma';
import { auth } from './better-auth';

/**
 * CC-POS-11 (#19): Better Auth over the real tables (users, sessions,
 * accounts) with the Prisma adapter, the migration and its trigger. Runs in CI
 * on the migrated and seeded throwaway database (`pnpm test:db`).
 */
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
if (process.env.NODE_ENV !== 'test' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
  throw new Error('test:db solo corre con NODE_ENV=test contra una base local descartable');
}

const db = new PrismaClient();
const BASE_URL = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
const TAG = `ci-19-${Date.now()}`;
const PASSWORD = 'Registro#2026';
const createdEmails: string[] = [];
let ipCounter = 0;

after(async () => {
  await db.user.deleteMany({ where: { email: { in: createdEmails } } });
  await db.$disconnect();
});

async function call(path: string, { body, cookie, method = 'POST' }: { body?: unknown; cookie?: string; method?: string } = {}) {
  const headers = new Headers({ origin: BASE_URL, 'x-forwarded-for': `10.19.0.${++ipCounter}` });
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  const res = await auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
  const text = await res.text();
  return {
    status: res.status,
    json: text ? (JSON.parse(text) as Record<string, unknown> | null) : null,
    cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '),
  };
}

async function signUp(label: string) {
  const email = `${TAG}-${label}@pos.test`;
  createdEmails.push(email);
  const res = await call('/sign-up/email', { body: { name: 'Prueba CI', email, password: PASSWORD } });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const user = await db.user.findFirstOrThrow({ where: { email } });
  return { ...res, email, user };
}

const sessionOf = async (cookie: string) => (await call('/get-session', { method: 'GET', cookie })).json;

test('usuario del seed (hash bcrypt copiado por el trigger) inicia sesión y su sesión queda en BD', async () => {
  const admin = await db.user.findFirstOrThrow({ where: { email: 'admin@pos.test', isDeleted: false } });
  const res = await call('/sign-in/email', { body: { email: 'admin@pos.test', password: 'Admin123!' } });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const session = await db.session.findFirstOrThrow({ where: { userId: admin.id, token: { not: null } }, orderBy: { createdAt: 'desc' } });
  assert.ok(session.expiresAt > new Date());
  assert.ok((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).lastLoginAt);
  await call('/sign-out', { cookie: res.cookie, body: {} });
});

test('registro: usuario con id UUIDv7, cuenta credential, sesión y sin membresía', async () => {
  const { user } = await signUp('registro');
  assert.match(user.id, /^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  assert.equal(user.isActive, true);
  assert.equal(user.isDeleted, false);
  const account = await db.account.findFirstOrThrow({ where: { userId: user.id, providerId: 'credential' } });
  assert.match(account.password ?? '', /^\$2[ab]\$12\$/);
  assert.equal(await db.session.count({ where: { userId: user.id } }), 1);
  assert.equal(await db.membership.count({ where: { userId: user.id } }), 0);
});

test('cerrar sesión borra la fila de sessions: la cookie anterior ya no autentica', async () => {
  const { cookie, user } = await signUp('logout');
  assert.ok(await sessionOf(cookie));
  assert.equal((await call('/sign-out', { cookie, body: {} })).status, 200);
  assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
  assert.equal(await sessionOf(cookie), null);
});

test('revocar la sesión en BD: la siguiente petición no está autenticada', async () => {
  const { cookie, user } = await signUp('revocada');
  await db.session.deleteMany({ where: { userId: user.id } });
  assert.equal(await sessionOf(cookie), null);
});

test('usuario desactivado o eliminado: no inicia sesión ni crea sesión', async () => {
  const { user, email } = await signUp('inactivo');
  await db.session.deleteMany({ where: { userId: user.id } });

  await db.user.update({ where: { id: user.id }, data: { isActive: false } });
  const inactive = await call('/sign-in/email', { body: { email, password: PASSWORD } });
  assert.equal(inactive.status, 403);

  await db.user.update({ where: { id: user.id }, data: { isActive: true, isDeleted: true, deletedAt: new Date() } });
  const deleted = await call('/sign-in/email', { body: { email, password: PASSWORD } });
  assert.equal(deleted.status, 401);
  assert.equal(await db.session.count({ where: { userId: user.id } }), 0);
});

test('la contraseña que pone el ADMIN (users.password_hash) es la que acepta el login', async () => {
  const { user, email } = await signUp('cambio');
  // Same write the user module does when an ADMIN sets a password.
  const bcrypt = await import('bcrypt');
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash('Nueva#Clave2026', 12) } });
  assert.equal((await call('/sign-in/email', { body: { email, password: PASSWORD } })).status, 401);
  assert.equal((await call('/sign-in/email', { body: { email, password: 'Nueva#Clave2026' } })).status, 200);
});
