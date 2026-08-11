import { test, expect } from '@playwright/test';
import { ADMIN, SELLER, loginUI, logout } from './fixtures/auth';

/**
 * Smoke de autenticación (P0 — E001, E002 del plan).
 * Valida los flujos de login mínimo que habilitan el resto de la suite.
 */
test.describe('Auth — login smoke (P0)', () => {
  test('E001 — Admin puede iniciar sesión y llega al dashboard', async ({ page }) => {
    await loginUI(page, ADMIN);

    // Sin cookie auth-token presente y URL en /dashboard (no en /onboarding).
    await expect(page).toHaveURL(/\/dashboard(\?|$)/);

    const cookies = await page.context().cookies('auth-token');
    expect(cookies.some((c) => c.name === 'auth-token' && c.value.length > 0)).toBe(true);
  });

  test('E002 — Seller puede iniciar sesión y llega al dashboard', async ({ page }) => {
    await loginUI(page, SELLER);
    await expect(page).toHaveURL(/\/dashboard(\?|$)/);

    const cookies = await page.context().cookies('auth-token');
    expect(cookies.some((c) => c.name === 'auth-token' && c.value.length > 0)).toBe(true);
  });

  test('E006 — Credenciales inválidas no generan sesión', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel(/correo electrónico/i).fill('nobody@pos.test');
    await page.getByLabel(/contraseña/i).fill('Wrong123!');
    await page.getByRole('button', { name: /iniciar sesión/i }).click();

    // Esperar toast de error (sonner).
    await expect(page.getByText(/inválidos|incorrectas/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/auth\/login/);

    const cookies = await page.context().cookies('auth-token');
    expect(cookies.some((c) => c.name === 'auth-token')).toBe(false);
  });

  test('Logout limpia la sesión', async ({ page }) => {
    await loginUI(page, ADMIN);
    await logout(page);

    // Al navegar a /dashboard sin cookie → redirect a /auth/login.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});