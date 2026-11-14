import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertSeedTarget } from './seed-guard';

const allowed = {
  NODE_ENV: 'test',
  POS_SEED_ALLOW_RESET: '1',
  DATABASE_URL: 'postgresql://pos:pos@localhost:55432/pos_seed?schema=public',
};

test('allows an explicit disposable local target', () => {
  assert.doesNotThrow(() => assertSeedTarget(allowed));
  assert.doesNotThrow(() => assertSeedTarget({ ...allowed, DATABASE_URL: 'postgresql://pos:pos@db:5432/pos' }));
});

test('rejects missing consent, production and unknown targets without echoing the URL', () => {
  for (const overrides of [
    { POS_SEED_ALLOW_RESET: undefined },
    { NODE_ENV: 'production' },
    { DATABASE_URL: undefined },
    { DATABASE_URL: 'not-a-url' },
    { DATABASE_URL: 'postgresql://user:secret@remote.example/pos_seed' },
    { DATABASE_URL: 'postgresql://user:secret@localhost/real_data' },
    { DATABASE_URL: 'postgresql://user:secret@localhost/pos_seed?schema=private' },
    { DATABASE_URL: 'postgresql://user:secret@localhost/pos_seed?host=remote.example' },
    { DATABASE_URL: 'postgresql://user:secret@localhost/pos_seed?schema=public&schema=private' },
    { DATABASE_URL: 'mysql://user:secret@localhost/pos_seed' },
  ]) {
    assert.throws(() => assertSeedTarget({ ...allowed, ...overrides }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes('secret'), false);
      return true;
    });
  }
});
