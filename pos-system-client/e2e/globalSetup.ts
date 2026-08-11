/**
 * globalSetup — espera el stack docker y resiempra la DB antes de cada corrida.
 *
 * Si E2E_SKIP_SEED=1 se salta el reseed (útil cuando iterás specs y no querés
 * perder el estado que estás probando). En CI dejalo siempre en 0.
 */
import type { FullConfig } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const LOGIN_PATH = '/auth/login';

async function waitForApp(timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}${LOGIN_PATH}`, {
        redirect: 'follow',
        headers: { 'User-Agent': 'playwright-e2e-globalSetup' },
      });
      if (res.ok || res.status === 200) {
        console.info(`✅ globalSetup: ${BASE_URL}${LOGIN_PATH} respondió 200.`);
        return;
      }
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 1_500));
  }
  throw new Error(
    `globalSetup: timeout esperando ${BASE_URL}${LOGIN_PATH}. Último error: ${String(lastError)}`,
  );
}

async function runSeed(): Promise<void> {
  // El seed vive en pos-system-client/prisma/seed.ts y se ejecuta con tsx,
  // desde el directorio del client. Usa process.env.DATABASE_URL del .env.
  // Si el client apunta a Supabase, sobreescribir temporalmente con la DB
  // local del compose.
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('pnpm', ['db:seed'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    cwd: process.cwd(),
  });
  if (result.status !== 0) {
    throw new Error(`globalSetup: 'pnpm db:seed' falló con código ${result.status}`);
  }
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  console.info('🌐 globalSetup: esperando stack docker...');
  await waitForApp();

  if (process.env.E2E_SKIP_SEED === '1') {
    console.info('⏭️  globalSetup: E2E_SKIP_SEED=1 — salteando reseed.');
    return;
  }
  console.info('🌱 globalSetup: reseeding DB...');
  await runSeed();
  console.info('✅ globalSetup: listo.');
}