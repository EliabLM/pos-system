/**
 * Startup check for the auth configuration. No imports on purpose: it runs in
 * src/instrumentation.ts, which Next also loads in the edge runtime.
 */

export type AuthEnv = Partial<Record<'NODE_ENV' | 'NEXT_PHASE' | 'BETTER_AUTH_URL' | 'BETTER_AUTH_SECRET', string>>;

/**
 * Production must not start without the app origin (trusted origin for CSRF
 * checks) and the secret. `next build` also runs with NODE_ENV=production and
 * may not have runtime variables, so the build phase is skipped.
 */
export function assertAuthEnv(env: AuthEnv): void {
  if (env.NODE_ENV !== 'production' || env.NEXT_PHASE === 'phase-production-build') return;
  if (!env.BETTER_AUTH_URL) {
    throw new Error('BETTER_AUTH_URL es obligatoria en producción (origen público de la app, p. ej. https://posagil.example.com)');
  }
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32) {
    throw new Error('BETTER_AUTH_SECRET es obligatoria en producción y debe tener al menos 32 caracteres');
  }
}
