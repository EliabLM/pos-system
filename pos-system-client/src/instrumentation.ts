import { assertAuthEnv } from '@/lib/auth/auth-env';

/** Runs once when the Next server starts: fail fast on missing auth config. */
export function register() {
  assertAuthEnv(process.env);
}
