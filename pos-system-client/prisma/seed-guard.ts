/** Guard for the destructive synthetic seed, not a production provisioning tool. */
export class SeedTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedTargetError';
  }
}

export function assertSeedTarget(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production') {
    throw new SeedTargetError('Seed disabled in production. Use a disposable development database.');
  }
  if (env.POS_SEED_ALLOW_RESET !== '1') {
    throw new SeedTargetError('Set POS_SEED_ALLOW_RESET=1 to confirm replacement of synthetic data.');
  }
  let target: URL;
  try {
    target = new URL(env.DATABASE_URL ?? '');
  } catch {
    throw new SeedTargetError('Seed requires an explicit PostgreSQL DATABASE_URL.');
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', 'db', 'seed-db']);
  const databases = new Set(['/pos', '/pos_seed', '/pos_test']);
  const allowedParameters = new Set(['schema', 'sslmode', 'connection_limit', 'pool_timeout', 'connect_timeout']);
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    !localHosts.has(target.hostname) ||
    !databases.has(target.pathname) ||
    target.hash ||
    [...target.searchParams.keys()].some((key) => !allowedParameters.has(key)) ||
    target.searchParams.getAll('schema').some((schema) => schema !== 'public')
  ) {
    throw new SeedTargetError('Seed only allows local development/test databases pos, pos_seed or pos_test using public schema.');
  }
}
