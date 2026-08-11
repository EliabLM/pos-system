import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — POS System (pos-system-client).
 *
 * Corre contra el stack local `docker compose up` (client en :3000).
 * No levanta el webServer: se asume que el stack ya está up. globalSetup
 * espera a que /auth/login responda 200 antes de ejecutar specs.
 *
 * Scripts:
 *   pnpm test:e2e           → corre toda la suite
 *   pnpm test:e2e:ui        → mode UI
 *   pnpm test:e2e:debug     → modo debug (Inspector)
 *   pnpm test:e2e:report    → abre último reporte HTML
 *
 * Variables (todas opcionales):
 *   E2E_BASE_URL      → http://localhost:3000 por defecto
 *   E2E_SKIP_SEED     → "1" salta el reseed del globalSetup (útil al iterar)
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 1 worker: la app corre en un solo contenedor y el login (bcrypt cost 12)
  // se degrada con logins concurrentes — más workers = timeouts flaky.
  workers: process.env.CI ? 2 : 1,
  timeout: 60_000,
  reporter: [
    ['html', { outputFolder: 'e2e/.report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'es-ES',
    timezoneId: 'America/Bogota',
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    // Ignorar errores de React DevTools / hydratuation warnings menores.
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalSetup: './e2e/globalSetup.ts',
});