-- Timestamps as timestamptz + BEFORE UPDATE trigger for updated_at + varchar→text
-- (Fase 1 paso 2c — skill postgresql-table-design).
-- Existing timestamp(3) values were written by Prisma in UTC, so the cast
-- interprets them AT TIME ZONE 'UTC' (no wall-clock shift).

-- ============================================================
-- timestamp(3) → timestamptz
-- ============================================================
ALTER TABLE "organizations"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

ALTER TABLE "stores"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

ALTER TABLE "users"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "last_login_at" TYPE timestamptz USING "last_login_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "password_changed_at" TYPE timestamptz USING "password_changed_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "locked_until" TYPE timestamptz USING "locked_until" AT TIME ZONE 'UTC';

ALTER TABLE "sessions"
  ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "revoked_at" TYPE timestamptz USING "revoked_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "last_activity_at" TYPE timestamptz USING "last_activity_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "last_activity_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC';

ALTER TABLE "password_resets"
  ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "used_at" TYPE timestamptz USING "used_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "email_verifications"
  ALTER COLUMN "expires_at" TYPE timestamptz USING "expires_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "verified_at" TYPE timestamptz USING "verified_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "audit_logs"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "categories"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

ALTER TABLE "brands"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

ALTER TABLE "unit_measures"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

ALTER TABLE "products"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

ALTER TABLE "customers"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

ALTER TABLE "suppliers"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

ALTER TABLE "payment_methods"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

ALTER TABLE "sales"
  ALTER COLUMN "sale_date" TYPE timestamptz USING "sale_date" AT TIME ZONE 'UTC',
  ALTER COLUMN "sale_date" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "due_date" TYPE timestamptz USING "due_date" AT TIME ZONE 'UTC',
  ALTER COLUMN "paid_date" TYPE timestamptz USING "paid_date" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

ALTER TABLE "sale_items"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

ALTER TABLE "sale_payments"
  ALTER COLUMN "payment_date" TYPE timestamptz USING "payment_date" AT TIME ZONE 'UTC',
  ALTER COLUMN "payment_date" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

ALTER TABLE "purchases"
  ALTER COLUMN "purchase_date" TYPE timestamptz USING "purchase_date" AT TIME ZONE 'UTC',
  ALTER COLUMN "purchase_date" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "received_date" TYPE timestamptz USING "received_date" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

ALTER TABLE "purchase_items"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

ALTER TABLE "stock_movements"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "system_configs"
  ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "deleted_at" TYPE timestamptz USING "deleted_at" AT TIME ZONE 'UTC';

-- ============================================================
-- varchar(n) → text (skill: no varchar length limits)
-- ============================================================
ALTER TABLE "sessions"
  ALTER COLUMN "ip_address" TYPE text,
  ALTER COLUMN "user_agent" TYPE text;
ALTER TABLE "password_resets"
  ALTER COLUMN "ip_address" TYPE text,
  ALTER COLUMN "user_agent" TYPE text;
ALTER TABLE "email_verifications"
  ALTER COLUMN "ip_address" TYPE text,
  ALTER COLUMN "user_agent" TYPE text;
ALTER TABLE "audit_logs"
  ALTER COLUMN "ip_address" TYPE text,
  ALTER COLUMN "user_agent" TYPE text;

-- ============================================================
-- updated_at BEFORE UPDATE trigger — covers non-Prisma writers
-- (future server modules, scripts, ad-hoc SQL). Prisma @updatedAt
-- still sets the value app-side; the trigger overrides with now().
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON "organizations" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER stores_set_updated_at BEFORE UPDATE ON "stores" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sessions_set_updated_at BEFORE UPDATE ON "sessions" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER categories_set_updated_at BEFORE UPDATE ON "categories" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER brands_set_updated_at BEFORE UPDATE ON "brands" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER unit_measures_set_updated_at BEFORE UPDATE ON "unit_measures" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON "products" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON "customers" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER suppliers_set_updated_at BEFORE UPDATE ON "suppliers" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payment_methods_set_updated_at BEFORE UPDATE ON "payment_methods" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sales_set_updated_at BEFORE UPDATE ON "sales" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sale_items_set_updated_at BEFORE UPDATE ON "sale_items" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER sale_payments_set_updated_at BEFORE UPDATE ON "sale_payments" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER purchases_set_updated_at BEFORE UPDATE ON "purchases" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER purchase_items_set_updated_at BEFORE UPDATE ON "purchase_items" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER system_configs_set_updated_at BEFORE UPDATE ON "system_configs" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
