-- CC-POS-11 (#19): authentication moves to Better Auth (email + password, sessions in DB).
-- Additive: new nullable columns; nothing is dropped. Legacy columns stay until a cleanup
-- issue removes them (sessions.token_hash/refresh_token_hash/rotated_from/is_active/revoked_*,
-- users.login_attempts/locked_until).
-- Revert: drop the trigger and function, the new columns and the index below.

-- Sessions: Better Auth looks a session up by its token.
ALTER TABLE "sessions" ADD COLUMN "token" TEXT;
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");
ALTER TABLE "sessions" ALTER COLUMN "token_hash" DROP NOT NULL;
-- Sessions of the old JWT cannot be used by Better Auth: everyone signs in again.
DELETE FROM "sessions";

-- Accounts: the credential (providerId "credential") keeps the password hash.
ALTER TABLE "accounts"
  ADD COLUMN "password" TEXT,
  ADD COLUMN "id_token" TEXT,
  ADD COLUMN "scope" TEXT,
  ADD COLUMN "access_token_expires_at" TIMESTAMPTZ,
  ADD COLUMN "refresh_token_expires_at" TIMESTAMPTZ;

-- Verifications (unused until now, 0 rows): Better Auth checks at runtime that it can
-- insert here (email verification, password reset) and stores the value as is.
ALTER TABLE "verifications"
  ADD COLUMN "value" TEXT,
  ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  ALTER COLUMN "value_hash" DROP NOT NULL,
  ALTER COLUMN "type" DROP NOT NULL;

-- Bridge: users.password_hash stays the place where the user module (ADMIN creates
-- sellers, changes passwords) and the seed write the bcrypt hash. Every write is copied
-- to the credential account that Better Auth reads, so those modules do not change in
-- this issue. Remove it when they write the account directly (invitations, #20).
CREATE FUNCTION sync_credential_account() RETURNS trigger AS $$
BEGIN
  IF NEW.password_hash IS NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO "accounts" ("user_id", "provider_id", "account_id", "password", "created_at", "updated_at")
  VALUES (NEW.id, 'credential', NEW.id::text, NEW.password_hash, now(), now())
  ON CONFLICT ("provider_id", "account_id") DO UPDATE SET "password" = EXCLUDED."password";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_sync_credential_account
  AFTER INSERT OR UPDATE OF "password_hash" ON "users"
  FOR EACH ROW EXECUTE FUNCTION sync_credential_account();

-- Existing users keep their password (bcrypt, verified by Better Auth with bcrypt).
INSERT INTO "accounts" ("user_id", "provider_id", "account_id", "password", "created_at", "updated_at")
SELECT "id", 'credential', "id"::text, "password_hash", now(), now()
FROM "users"
WHERE "password_hash" IS NOT NULL
ON CONFLICT ("provider_id", "account_id") DO UPDATE SET "password" = EXCLUDED."password";
