-- CC-POS-12 (#20): roles and invitations with the Better Auth organization plugin.
-- Additive: a new table and a nullable column. The plugin maps its models onto
-- organizations, memberships (role = membership_role: ADMIN/SELLER) and invitations.
-- Revert: drop the table "invitations", sessions.active_organization_id and
-- organizations.logo/metadata.

-- Columns of the plugin's organization model (unused by the app, nullable).
ALTER TABLE "organizations" ADD COLUMN "logo" TEXT, ADD COLUMN "metadata" TEXT;

-- Active organization of the session: getActor() takes the tenant from here.
ALTER TABLE "sessions" ADD COLUMN "active_organization_id" UUID;
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_active_organization_id_fkey"
  FOREIGN KEY ("active_organization_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Open sessions keep working: their active organization is the oldest ACTIVE
-- membership of an active, non-deleted organization (ACTIVE_MEMBERSHIP_WHERE,
-- the rule getActor() applied before).
UPDATE "sessions" s
SET "active_organization_id" = m."organization_id"
FROM (
  SELECT DISTINCT ON (m."user_id") m."user_id", m."organization_id"
  FROM "memberships" m
  JOIN "organizations" o ON o."id" = m."organization_id"
  WHERE m."deleted_at" IS NULL AND m."status" = 'ACTIVE'
    AND o."is_deleted" = false AND o."is_active" = true
  ORDER BY m."user_id", m."created_at" ASC
) m
WHERE s."user_id" = m."user_id";

-- Invitations. The id is the secret of the link the ADMIN shares: random UUIDv4
-- (gen_random_uuid), not UUIDv7, so it cannot be guessed from the time.
CREATE TABLE "invitations" (
  "id"              UUID            NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID            NOT NULL,
  "email"           TEXT            NOT NULL,
  "role"            "membership_role" NOT NULL DEFAULT 'SELLER',
  "status"          TEXT            NOT NULL DEFAULT 'pending',
  "inviter_id"      UUID            NOT NULL,
  "expires_at"      TIMESTAMPTZ     NOT NULL,
  "created_at"      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invitations_status_check"
    CHECK ("status" IN ('pending', 'accepted', 'rejected', 'canceled')),
  CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invitations_inviter_id_fkey" FOREIGN KEY ("inviter_id")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "invitations_organization_id_status_idx" ON "invitations"("organization_id", "status");
CREATE INDEX "invitations_email_idx" ON "invitations"("email");
CREATE INDEX "invitations_inviter_id_idx" ON "invitations"("inviter_id");

CREATE TRIGGER invitations_set_updated_at
  BEFORE UPDATE ON "invitations" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS (convención 2g), same policy as memberships.
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "invitations"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );
