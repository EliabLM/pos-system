-- Auth target schema — reshape (Fase 1 pasos 3b/3c; docs/auth/AUTH_TARGET_SCHEMA.md R6).
-- Destructivo y coordinado con el refactor del client en el mismo commit:
--   users: password→password_hash (nullable), first+last→name, +image,
--          -username, -organization_id, -store_id, -role (tenancy via memberships)
--   sessions: token→token_hash
--   audit_logs: actor-action-target + store_id + correlation_id
--   password_resets / email_verifications: DROP (merged en verifications en 3a)

-- ============================================================
-- users (D3.4, D3.5, D3.6)
-- ============================================================
ALTER TABLE "users" RENAME COLUMN "password" TO "password_hash";
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

ALTER TABLE "users" ADD COLUMN "name" text;
UPDATE "users" SET "name" = NULLIF(btrim("first_name" || ' ' || "last_name"), '');
UPDATE "users" SET "name" = split_part("email", '@', 1) WHERE "name" IS NULL;
ALTER TABLE "users" ALTER COLUMN "name" SET NOT NULL;

ALTER TABLE "users" ADD COLUMN "image" text;

ALTER TABLE "users" DROP COLUMN "first_name";
ALTER TABLE "users" DROP COLUMN "last_name";

DROP INDEX "users_username_key";
ALTER TABLE "users" DROP COLUMN "username";

-- ============================================================
-- memberships: asegurar cobertura ANTES de dropear la tenancy de users (R6).
-- Idempotente (3a ya pobló los users vivos); acá se cubren además los users
-- soft-deleted, con el membership igualmente soft-deleted para poder restaurar.
-- ============================================================
INSERT INTO "memberships" ("user_id", "organization_id", "role", "default_store_id", "status", "accepted_at", "created_at", "updated_at", "deleted_at")
SELECT u.id, u.organization_id, u.role::text::"membership_role", u.store_id, 'ACTIVE', u.created_at, u.created_at, u.created_at, u.deleted_at
FROM "users" u
WHERE u.organization_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m.user_id = u.id AND m.organization_id = u.organization_id
  );

-- ============================================================
-- users pierde la tenancy directa (D3.3 / 3c)
-- ============================================================
ALTER TABLE "users" DROP CONSTRAINT "users_organization_id_fkey";
ALTER TABLE "users" DROP CONSTRAINT "users_store_id_fkey";
DROP INDEX "users_organization_id_is_deleted_is_active_idx";
DROP INDEX "users_store_id_idx";

-- users pasa a ser tabla de IDENTIDAD global (como sessions/verifications):
-- su tenancy vive en memberships, que sí tiene RLS. Se retira la policy de 2g.
DROP POLICY tenant_isolation ON "users";
ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;

ALTER TABLE "users" DROP COLUMN "organization_id";
ALTER TABLE "users" DROP COLUMN "store_id";
ALTER TABLE "users" DROP COLUMN "role";
DROP TYPE "user_role";

-- ============================================================
-- sessions: token → token_hash (el valor SIEMPRE fue un hash SHA-256)
-- ============================================================
ALTER TABLE "sessions" RENAME COLUMN "token" TO "token_hash";
ALTER INDEX "sessions_token_key" RENAME TO "sessions_token_hash_key";
ALTER INDEX "sessions_token_idx" RENAME TO "sessions_token_hash_idx";

-- ============================================================
-- audit_logs → actor-action-target (D3.8)
-- ============================================================
ALTER TABLE "audit_logs" RENAME COLUMN "user_id" TO "actor_user_id";
ALTER TABLE "audit_logs" RENAME COLUMN "entity" TO "target_type";
ALTER TABLE "audit_logs" RENAME COLUMN "entity_id" TO "target_id";
ALTER TABLE "audit_logs" ALTER COLUMN "target_type" DROP NOT NULL;

-- target_id pasa a uuid: los valores ya fueron remapeados en 2f donde hubo match;
-- los restos no-uuid (referencias legacy irrecuperables) se anulan a propósito.
UPDATE "audit_logs" SET "target_id" = NULL
WHERE "target_id" IS NOT NULL
  AND "target_id" !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
ALTER TABLE "audit_logs" ALTER COLUMN "target_id" TYPE uuid USING "target_id"::uuid;

ALTER TABLE "audit_logs" ADD COLUMN "store_id" uuid;
ALTER TABLE "audit_logs" ADD COLUMN "correlation_id" text;

ALTER TABLE "audit_logs" RENAME CONSTRAINT "audit_logs_user_id_fkey" TO "audit_logs_actor_user_id_fkey";
ALTER INDEX "audit_logs_user_id_idx" RENAME TO "audit_logs_actor_user_id_idx";
DROP INDEX "audit_logs_entity_entity_id_idx";
DROP INDEX "audit_logs_organization_id_idx";
DROP INDEX "audit_logs_created_at_idx";
DROP INDEX "audit_logs_action_idx";
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- audit_action: se EXTIENDE con los valores del target (los legacy se conservan —
-- Postgres no permite quitar valores de un enum y hay filas que los usan).
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'LOGOUT_ALL';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'PASSWORD_CHANGE';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'ROLE_CHANGE';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'SOFT_DELETE';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'EXPORT';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'VIEW_SENSITIVE';

-- ============================================================
-- Tablas legacy de verificación: los datos ya viven en verifications (3a)
-- ============================================================
DROP TABLE "password_resets";
DROP TABLE "email_verifications";
