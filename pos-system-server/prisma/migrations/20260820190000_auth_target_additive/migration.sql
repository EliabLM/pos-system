-- Auth target schema — bloque aditivo (Fase 1 paso 3a; ver docs/auth/AUTH_TARGET_SCHEMA.md).
-- Solo agrega: organizations.slug (D3.10/R7), memberships (D3.3), verifications
-- (D3.7), accounts skeleton (D3.9), y columnas de refresh rotation en sessions.
-- Los renames destructivos (users reshape, sessions.token→token_hash, audit_logs)
-- llegan en los bloques 3b/3c junto con el refactor del client.

-- ============================================================
-- Enums nuevos
-- ============================================================
CREATE TYPE "membership_role" AS ENUM ('ADMIN', 'SELLER');
CREATE TYPE "membership_status" AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');
CREATE TYPE "verification_type" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFY', 'MAGIC_LINK', 'CHANGE_EMAIL');

-- ============================================================
-- organizations.slug (D3.10, Receta R7)
-- ============================================================
CREATE OR REPLACE FUNCTION slugify(input text) RETURNS text AS $$
  SELECT NULLIF(
    btrim(
      regexp_replace(
        lower(translate(input, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-'
    ),
  '')
$$ LANGUAGE sql IMMUTABLE;

ALTER TABLE "organizations" ADD COLUMN "slug" text;

-- Poblar orgs existentes: slugify(name) con fallback y desambiguación -2, -3, ...
WITH base AS (
  SELECT id, COALESCE(slugify(name), 'org-' || substr(id::text, 1, 8)) AS s
  FROM "organizations"
), numbered AS (
  SELECT id, s, row_number() OVER (PARTITION BY s ORDER BY id) AS rn
  FROM base
)
UPDATE "organizations" o
SET slug = CASE WHEN n.rn = 1 THEN n.s ELSE n.s || '-' || n.rn END
FROM numbered n
WHERE n.id = o.id;

ALTER TABLE "organizations" ALTER COLUMN "slug" SET NOT NULL,
                            ALTER COLUMN "slug" SET DEFAULT '';
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- Trigger R7: las orgs nuevas generan slug desde name al insertar (el client
-- legacy no envía slug — inserta el DEFAULT '' y el trigger lo reemplaza).
CREATE OR REPLACE FUNCTION organizations_slug_default() RETURNS trigger AS $$
DECLARE
  base_slug text;
  candidate text;
  n int := 1;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    base_slug := COALESCE(slugify(NEW.name), 'org-' || substr(NEW.id::text, 1, 8));
    candidate := base_slug;
    WHILE EXISTS (SELECT 1 FROM "organizations" WHERE slug = candidate) LOOP
      n := n + 1;
      candidate := base_slug || '-' || n;
    END LOOP;
    NEW.slug := candidate;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_slug_default
  BEFORE INSERT ON "organizations"
  FOR EACH ROW EXECUTE FUNCTION organizations_slug_default();

-- ============================================================
-- memberships (D3.3) — desacopla user↔org; poblada desde users (R6 paso 1).
-- users conserva organization_id/store_id/role hasta el bloque 3c.
-- ============================================================
CREATE TABLE "memberships" (
  "id"               uuid NOT NULL DEFAULT uuidv7(),
  "user_id"          uuid NOT NULL,
  "organization_id"  uuid NOT NULL,
  "role"             "membership_role" NOT NULL DEFAULT 'SELLER',
  "default_store_id" uuid,
  "status"           "membership_status" NOT NULL DEFAULT 'ACTIVE',
  "invited_by"       uuid,
  "accepted_at"      timestamptz,
  "created_at"       timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       timestamptz NOT NULL,
  "deleted_at"       timestamptz,

  CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_default_store_id_fkey"
  FOREIGN KEY ("default_store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- unique (user_id, organization_id) WHERE deleted_at IS NULL — partial index (convención 2b)
CREATE UNIQUE INDEX "memberships_user_id_organization_id_key"
  ON "memberships"("user_id", "organization_id") WHERE "deleted_at" IS NULL;
CREATE INDEX "memberships_organization_id_role_idx" ON "memberships"("organization_id", "role");
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");
CREATE INDEX "memberships_default_store_id_idx" ON "memberships"("default_store_id");

CREATE TRIGGER memberships_set_updated_at
  BEFORE UPDATE ON "memberships" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS (convención 2g)
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "memberships"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

-- Poblar desde users (R6 paso 1): un membership ACTIVE por user con org.
-- users sin organization_id (pre-onboarding) no generan membership: la crea el
-- onboarding cuando asigna la org (hoy vía users.organization_id; en 3c directo acá).
INSERT INTO "memberships" ("user_id", "organization_id", "role", "default_store_id", "status", "accepted_at", "created_at", "updated_at")
SELECT u.id, u.organization_id, u.role::text::"membership_role", u.store_id, 'ACTIVE', u.created_at, u.created_at, u.created_at
FROM "users" u
WHERE u.organization_id IS NOT NULL AND u.is_deleted = false;

-- ============================================================
-- verifications (D3.7) — merge de password_resets + email_verifications (R6 paso 2).
-- Las tablas viejas siguen vivas hasta 3b (el client aún escribe en ellas);
-- en el cutover real toda la cadena corre junta, así que no hay ventana de drift.
-- ============================================================
CREATE TABLE "verifications" (
  "id"         uuid NOT NULL DEFAULT uuidv7(),
  "identifier" text NOT NULL,
  "value_hash" text NOT NULL,
  "type"       "verification_type" NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used"       boolean NOT NULL DEFAULT false,
  "used_at"    timestamptz,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "verifications_value_hash_key" ON "verifications"("value_hash");
CREATE INDEX "verifications_identifier_type_used_idx" ON "verifications"("identifier", "type", "used");
CREATE INDEX "verifications_expires_at_idx" ON "verifications"("expires_at");

INSERT INTO "verifications" ("identifier", "value_hash", "type", "expires_at", "used", "used_at", "ip_address", "user_agent", "created_at")
SELECT u.email, pr.token, 'PASSWORD_RESET', pr.expires_at, pr.used, pr.used_at, pr.ip_address, pr.user_agent, pr.created_at
FROM "password_resets" pr
JOIN "users" u ON u.id = pr.user_id;

INSERT INTO "verifications" ("identifier", "value_hash", "type", "expires_at", "used", "used_at", "ip_address", "user_agent", "created_at")
SELECT ev.email, ev.token, 'EMAIL_VERIFY', ev.expires_at, ev.verified, ev.verified_at, ev.ip_address, ev.user_agent, ev.created_at
FROM "email_verifications" ev;

-- ============================================================
-- accounts skeleton (D3.9) — schema ahora, datos en Fase 2 (OAuth/passkey/totp).
-- ============================================================
CREATE TABLE "accounts" (
  "id"            uuid NOT NULL DEFAULT uuidv7(),
  "user_id"       uuid NOT NULL,
  "provider_id"   text NOT NULL,
  "account_id"    text NOT NULL,
  "access_token"  text,
  "refresh_token" text,
  "expires_at"    timestamptz,
  "metadata"      jsonb,
  "created_at"    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    timestamptz NOT NULL,

  CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "accounts_provider_id_account_id_key" ON "accounts"("provider_id", "account_id");
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON "accounts" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- sessions: columnas de refresh rotation (el rename token→token_hash va en 3b)
-- ============================================================
ALTER TABLE "sessions"
  ADD COLUMN "refresh_token_hash" text,
  ADD COLUMN "rotated_from" uuid;
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");
