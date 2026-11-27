import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { PrismaClient } from '@/generated/prisma';

/**
 * #20: the migration fills sessions.active_organization_id for open sessions.
 * It must follow getActor()'s rule (ACTIVE membership of an active,
 * non-deleted organization, oldest first). Runs the migration's own UPDATE on
 * crafted rows inside a transaction that is rolled back.
 */
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
if (process.env.NODE_ENV !== 'test' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
  throw new Error('test:db solo corre con NODE_ENV=test contra una base local descartable');
}

const db = new PrismaClient();
after(() => db.$disconnect());

const MIGRATION = new URL(
  '../../../../pos-system-server/prisma/migrations/20261127000000_organization_invitations/migration.sql',
  import.meta.url,
);

function backfillStatement(): string {
  const sql = readFileSync(MIGRATION, 'utf8');
  const start = sql.indexOf('UPDATE "sessions" s');
  assert.ok(start >= 0, 'la migración rellena sessions.active_organization_id');
  return sql.slice(start, sql.indexOf(';', start) + 1);
}

class Rollback extends Error {}

test('relleno: la membresía más antigua de una organización desactivada no gana a una activa', async () => {
  const tag = `ci-20-backfill-${Date.now()}`;
  const result = await db
    .$transaction(async (tx) => {
      const off = await tx.organization.create({ data: { name: `${tag} off`, email: 'off@pos.test', isActive: false } });
      const on = await tx.organization.create({ data: { name: `${tag} on`, email: 'on@pos.test' } });
      const user = await tx.user.create({ data: { name: 'Relleno', email: `${tag}@pos.test` } });
      await tx.membership.create({
        data: { userId: user.id, organizationId: off.id, role: 'SELLER', createdAt: new Date('2026-01-01T00:00:00Z') },
      });
      await tx.membership.create({
        data: { userId: user.id, organizationId: on.id, role: 'SELLER', createdAt: new Date('2026-06-01T00:00:00Z') },
      });
      const session = await tx.session.create({
        data: { userId: user.id, token: `${tag}-token`, expiresAt: new Date(Date.now() + 86_400_000) },
      });
      await tx.$executeRawUnsafe(backfillStatement());
      const filled = await tx.session.findUniqueOrThrow({ where: { id: session.id } });
      throw Object.assign(new Rollback(), { value: { filled: filled.activeOrganizationId, expected: on.id } });
    })
    .catch((error: unknown) => {
      if (error instanceof Rollback) return (error as Rollback & { value: { filled: string | null; expected: string } }).value;
      throw error;
    });
  assert.equal(result.filled, result.expected);
});
