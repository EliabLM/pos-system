import { test, expect } from '@playwright/test';
import { SELLER, loginUI } from './fixtures/auth';

/**
 * Smoke de RBAC de navegación (P0 — E162, E164, E173 del plan).
 * Valida que el middleware redirige al SELLER a /dashboard cuando intenta
 * rutas prohibidas por `src/lib/rbac.ts`:
 *   products, categories, brands, unit-measures, payment-methods,
 *   customers, suppliers, stores, users, movements, purchases, reports.
 */
test.describe('Navigation RBAC — seller redirigido (P0)', () => {
  test.beforeEach(async ({ page }) => {
    await loginUI(page, SELLER);
  });

  // Rutas a las que el SELLER debe ser redirigido a /dashboard.
  const forbiddenRoutes = [
    '/dashboard/products',
    '/dashboard/categories',
    '/dashboard/brands',
    '/dashboard/unit-measures',
    '/dashboard/payment-methods',
    '/dashboard/customers',
    '/dashboard/suppliers',
    '/dashboard/stores',
    '/dashboard/users',
    '/dashboard/movements',
    '/dashboard/purchases',
    '/dashboard/reports',
  ];

  for (const route of forbiddenRoutes) {
    test(`E162+ — Seller no accede a ${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/dashboard(\?|$)/);
    });
  }

  test('E158/E159 — Seller SÍ accede a /dashboard y /dashboard/sales', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard(\?|$)/);

    await page.goto('/dashboard/sales');
    await expect(page).toHaveURL(/\/dashboard\/sales(\?|$)/);
  });
});