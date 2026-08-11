/**
 * Fixtures de autenticación para specs E2E.
 *
 * `loginUI` ingresa por la UI real (probar el form de login en sí).
 * `loginAs` setea la cookie directamente vía contexto del navegador — más rápido
 * y sin flakiness, recomendado para specs que no prueban el login.
 *
 * Las credenciales están sembradas en `prisma/seed.ts`:
 *   admin@pos.test / Admin123!    (ADMIN)
 *   seller@pos.test / Seller123!  (SELLER)
 */
import { Page, expect } from '@playwright/test';

export interface Credentials {
  email: string;
  password: string;
}

export const ADMIN: Credentials = { email: 'admin@pos.test', password: 'Admin123!' };
export const SELLER: Credentials = { email: 'seller@pos.test', password: 'Seller123!' };

const AUTH_COOKIE = 'auth-token';

/**
 * Login por UI — para specs que prueban el flujo de login/validaciones.
 * Espera a que la URL cambie a /dashboard (middleware lo redirige tras éxito).
 */
export async function loginUI(page: Page, creds: Credentials, expectedPath = '/dashboard'): Promise<void> {
  await page.goto('/auth/login');

  await page.getByLabel(/correo electrónico/i).fill(creds.email);
  await page.getByLabel(/contraseña/i).fill(creds.password);

  await page.getByRole('button', { name: /iniciar sesión/i }).click();

  // El form hace window.location.href tras el éxito → esperar la URL esperada.
  await page.waitForURL(`**${expectedPath}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(`${escapeRegex(expectedPath)}(\\?|$)`));
}

/**
 * Login directo por cookie — útil para specs que no prueban el login en sí.
 * NO dispara el form real, así que en specs que prueban validaciones de form
 * usá `loginUI` (que valida por Yup) o `goto` fresh sin sesión.
 *
 * Implementación: navega a /auth/login, hace el submit real una sola vez para
 * obtener el JWT y lo setea en el contexto. Si ya hay una cookie válida, no
 * repite el login (rápido entre specs del mismo worker).
 */
export async function loginAs(page: Page, creds: Credentials): Promise<void> {
  // Verificar si ya hay sesión activa.
  const existing = await page.context().cookies(AUTH_COOKIE);
  if (existing.length > 0 && existing[0].value) {
    // Validar que la cookie sirva yendo a /dashboard.
    const res = await page.goto('/dashboard');
    if (res && res.ok() && !res.url().includes('/auth/login')) return;
  }
  await loginUI(page, creds);
}

export async function logout(page: Page): Promise<void> {
  // Disparar logout vía UI cuando exista, por ahora limpiamos la cookie.
  await page.context().clearCookies();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}