-- cuid → UUIDv7 (Fase 1 paso 2f — Receta R1). BORRADOR — revisar antes de mover.
-- Los cuid no son convertibles: se generan UUIDv7 nuevos y se mantiene el mapeo
-- en legacy_id_map para el periodo de transición (la API aceptará cuid legacy
-- via lookup hasta Fase 5).

-- ============================================================
-- uuidv7() para PG17 (sin soporte nativo): implementación estándar
-- gen_random_uuid() + timestamp ms en los primeros 48 bits + version bits 0111.
-- Cuando el server (Fase 2+) genere IDs app-side, esta función queda como default.
-- ============================================================
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
BEGIN
  RETURN encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                placing substring(int8send(floor(extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
                from 1 for 6),
        52, 1),
      53, 1),
    'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

-- ============================================================
-- legacy_id_map — puente cuid→uuid por entidad (Receta R1 paso 1)
-- ============================================================
CREATE TABLE "legacy_id_map" (
  "entity"    text NOT NULL,
  "legacy_id" text NOT NULL,
  "new_uuid"  uuid NOT NULL,
  CONSTRAINT "legacy_id_map_pkey" PRIMARY KEY ("entity", "legacy_id")
);

-- Poblar el mapa: un uuidv7 nuevo por cada fila de cada entidad.
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'organizations', id, uuidv7() FROM "organizations";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'stores', id, uuidv7() FROM "stores";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'users', id, uuidv7() FROM "users";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'sessions', id, uuidv7() FROM "sessions";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'password_resets', id, uuidv7() FROM "password_resets";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'email_verifications', id, uuidv7() FROM "email_verifications";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'audit_logs', id, uuidv7() FROM "audit_logs";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'categories', id, uuidv7() FROM "categories";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'brands', id, uuidv7() FROM "brands";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'unit_measures', id, uuidv7() FROM "unit_measures";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'products', id, uuidv7() FROM "products";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'customers', id, uuidv7() FROM "customers";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'suppliers', id, uuidv7() FROM "suppliers";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'payment_methods', id, uuidv7() FROM "payment_methods";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'sales', id, uuidv7() FROM "sales";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'sale_items', id, uuidv7() FROM "sale_items";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'sale_payments', id, uuidv7() FROM "sale_payments";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'purchases', id, uuidv7() FROM "purchases";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'purchase_items', id, uuidv7() FROM "purchase_items";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'stock_movements', id, uuidv7() FROM "stock_movements";
INSERT INTO "legacy_id_map" ("entity", "legacy_id", "new_uuid") SELECT 'system_configs', id, uuidv7() FROM "system_configs";

-- ============================================================
-- Soltar FKs (se recrean al final) para poder remapear PKs y FKs libremente.
-- ============================================================
ALTER TABLE "stores" DROP CONSTRAINT "stores_organization_id_fkey";
ALTER TABLE "users" DROP CONSTRAINT "users_organization_id_fkey";
ALTER TABLE "users" DROP CONSTRAINT "users_store_id_fkey";
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_user_id_fkey";
ALTER TABLE "password_resets" DROP CONSTRAINT "password_resets_user_id_fkey";
ALTER TABLE "email_verifications" DROP CONSTRAINT "email_verifications_user_id_fkey";
ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_user_id_fkey";
ALTER TABLE "categories" DROP CONSTRAINT "categories_organization_id_fkey";
ALTER TABLE "brands" DROP CONSTRAINT "brands_organization_id_fkey";
ALTER TABLE "unit_measures" DROP CONSTRAINT "unit_measures_organization_id_fkey";
ALTER TABLE "products" DROP CONSTRAINT "products_organization_id_fkey";
ALTER TABLE "products" DROP CONSTRAINT "products_category_id_fkey";
ALTER TABLE "products" DROP CONSTRAINT "products_brand_id_fkey";
ALTER TABLE "products" DROP CONSTRAINT "products_unit_measure_id_fkey";
ALTER TABLE "customers" DROP CONSTRAINT "customers_organization_id_fkey";
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_organization_id_fkey";
ALTER TABLE "payment_methods" DROP CONSTRAINT "payment_methods_organization_id_fkey";
ALTER TABLE "sales" DROP CONSTRAINT "sales_store_id_fkey";
ALTER TABLE "sales" DROP CONSTRAINT "sales_customer_id_fkey";
ALTER TABLE "sales" DROP CONSTRAINT "sales_user_id_fkey";
ALTER TABLE "sale_items" DROP CONSTRAINT "sale_items_sale_id_fkey";
ALTER TABLE "sale_items" DROP CONSTRAINT "sale_items_product_id_fkey";
ALTER TABLE "sale_items" DROP CONSTRAINT "sale_items_unit_measure_id_fkey";
ALTER TABLE "sale_payments" DROP CONSTRAINT "sale_payments_sale_id_fkey";
ALTER TABLE "sale_payments" DROP CONSTRAINT "sale_payments_payment_method_id_fkey";
ALTER TABLE "purchases" DROP CONSTRAINT "purchases_supplier_id_fkey";
ALTER TABLE "purchase_items" DROP CONSTRAINT "purchase_items_purchase_id_fkey";
ALTER TABLE "purchase_items" DROP CONSTRAINT "purchase_items_product_id_fkey";
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_organization_id_fkey";
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_product_id_fkey";
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_user_id_fkey";
ALTER TABLE "system_configs" DROP CONSTRAINT "system_configs_organization_id_fkey";

-- ============================================================
-- Remapear valores (UPDATE ... FROM legacy_id_map) y castear a uuid.
-- ============================================================
-- organizations
UPDATE "organizations" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.id;
ALTER TABLE "organizations" ALTER COLUMN "id" TYPE uuid USING id::uuid, ALTER COLUMN "id" SET DEFAULT uuidv7();

-- stores
UPDATE "stores" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'stores' AND m.legacy_id = t.id;
UPDATE "stores" t SET organization_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.organization_id;
ALTER TABLE "stores"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "organization_id" TYPE uuid USING organization_id::uuid;

-- users (revoked_by en sessions se remapea junto a sessions)
UPDATE "users" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'users' AND m.legacy_id = t.id;
UPDATE "users" t SET organization_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.organization_id;
UPDATE "users" t SET store_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'stores' AND m.legacy_id = t.store_id;
ALTER TABLE "users"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "organization_id" TYPE uuid USING organization_id::uuid,
  ALTER COLUMN "store_id" TYPE uuid USING store_id::uuid;

-- sessions
UPDATE "sessions" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'sessions' AND m.legacy_id = t.id;
UPDATE "sessions" t SET user_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'users' AND m.legacy_id = t.user_id;
UPDATE "sessions" t SET revoked_by = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'users' AND m.legacy_id = t.revoked_by;
ALTER TABLE "sessions"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "user_id" TYPE uuid USING user_id::uuid,
  ALTER COLUMN "revoked_by" TYPE uuid USING revoked_by::uuid;

-- password_resets
UPDATE "password_resets" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'password_resets' AND m.legacy_id = t.id;
UPDATE "password_resets" t SET user_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'users' AND m.legacy_id = t.user_id;
ALTER TABLE "password_resets"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "user_id" TYPE uuid USING user_id::uuid;

-- email_verifications
UPDATE "email_verifications" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'email_verifications' AND m.legacy_id = t.id;
UPDATE "email_verifications" t SET user_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'users' AND m.legacy_id = t.user_id;
ALTER TABLE "email_verifications"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "user_id" TYPE uuid USING user_id::uuid;

-- audit_logs (entity_id es polimórfico: se remapea todo valor encontrado en el
-- mapa pero se mantiene text — el reshape a target_type/target_id llega en paso 3)
UPDATE "audit_logs" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'audit_logs' AND m.legacy_id = t.id;
UPDATE "audit_logs" t SET user_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'users' AND m.legacy_id = t.user_id;
UPDATE "audit_logs" t SET organization_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.organization_id;
UPDATE "audit_logs" t SET entity_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.legacy_id = t.entity_id;
ALTER TABLE "audit_logs"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "user_id" TYPE uuid USING user_id::uuid,
  ALTER COLUMN "organization_id" TYPE uuid USING organization_id::uuid;

-- categories
UPDATE "categories" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'categories' AND m.legacy_id = t.id;
UPDATE "categories" t SET organization_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.organization_id;
ALTER TABLE "categories"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "organization_id" TYPE uuid USING organization_id::uuid;

-- brands
UPDATE "brands" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'brands' AND m.legacy_id = t.id;
UPDATE "brands" t SET organization_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.organization_id;
ALTER TABLE "brands"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "organization_id" TYPE uuid USING organization_id::uuid;

-- unit_measures
UPDATE "unit_measures" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'unit_measures' AND m.legacy_id = t.id;
UPDATE "unit_measures" t SET organization_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.organization_id;
ALTER TABLE "unit_measures"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "organization_id" TYPE uuid USING organization_id::uuid;

-- products
UPDATE "products" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'products' AND m.legacy_id = t.id;
UPDATE "products" t SET organization_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.organization_id;
UPDATE "products" t SET category_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'categories' AND m.legacy_id = t.category_id;
UPDATE "products" t SET brand_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'brands' AND m.legacy_id = t.brand_id;
UPDATE "products" t SET unit_measure_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'unit_measures' AND m.legacy_id = t.unit_measure_id;
ALTER TABLE "products"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "organization_id" TYPE uuid USING organization_id::uuid,
  ALTER COLUMN "category_id" TYPE uuid USING category_id::uuid,
  ALTER COLUMN "brand_id" TYPE uuid USING brand_id::uuid,
  ALTER COLUMN "unit_measure_id" TYPE uuid USING unit_measure_id::uuid;

-- customers
UPDATE "customers" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'customers' AND m.legacy_id = t.id;
UPDATE "customers" t SET organization_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.organization_id;
ALTER TABLE "customers"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "organization_id" TYPE uuid USING organization_id::uuid;

-- suppliers
UPDATE "suppliers" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'suppliers' AND m.legacy_id = t.id;
UPDATE "suppliers" t SET organization_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.organization_id;
ALTER TABLE "suppliers"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "organization_id" TYPE uuid USING organization_id::uuid;

-- payment_methods
UPDATE "payment_methods" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'payment_methods' AND m.legacy_id = t.id;
UPDATE "payment_methods" t SET organization_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.organization_id;
ALTER TABLE "payment_methods"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "organization_id" TYPE uuid USING organization_id::uuid;

-- sales
UPDATE "sales" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'sales' AND m.legacy_id = t.id;
UPDATE "sales" t SET organization_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.organization_id;
UPDATE "sales" t SET store_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'stores' AND m.legacy_id = t.store_id;
UPDATE "sales" t SET customer_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'customers' AND m.legacy_id = t.customer_id;
UPDATE "sales" t SET user_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'users' AND m.legacy_id = t.user_id;
ALTER TABLE "sales"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "organization_id" TYPE uuid USING organization_id::uuid,
  ALTER COLUMN "store_id" TYPE uuid USING store_id::uuid,
  ALTER COLUMN "customer_id" TYPE uuid USING customer_id::uuid,
  ALTER COLUMN "user_id" TYPE uuid USING user_id::uuid;

-- sale_items
UPDATE "sale_items" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'sale_items' AND m.legacy_id = t.id;
UPDATE "sale_items" t SET sale_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'sales' AND m.legacy_id = t.sale_id;
UPDATE "sale_items" t SET product_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'products' AND m.legacy_id = t.product_id;
UPDATE "sale_items" t SET unit_measure_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'unit_measures' AND m.legacy_id = t.unit_measure_id;
ALTER TABLE "sale_items"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "sale_id" TYPE uuid USING sale_id::uuid,
  ALTER COLUMN "product_id" TYPE uuid USING product_id::uuid,
  ALTER COLUMN "unit_measure_id" TYPE uuid USING unit_measure_id::uuid;

-- sale_payments
UPDATE "sale_payments" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'sale_payments' AND m.legacy_id = t.id;
UPDATE "sale_payments" t SET sale_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'sales' AND m.legacy_id = t.sale_id;
UPDATE "sale_payments" t SET payment_method_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'payment_methods' AND m.legacy_id = t.payment_method_id;
ALTER TABLE "sale_payments"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "sale_id" TYPE uuid USING sale_id::uuid,
  ALTER COLUMN "payment_method_id" TYPE uuid USING payment_method_id::uuid;

-- purchases
UPDATE "purchases" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'purchases' AND m.legacy_id = t.id;
UPDATE "purchases" t SET organization_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.organization_id;
UPDATE "purchases" t SET supplier_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'suppliers' AND m.legacy_id = t.supplier_id;
ALTER TABLE "purchases"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "organization_id" TYPE uuid USING organization_id::uuid,
  ALTER COLUMN "supplier_id" TYPE uuid USING supplier_id::uuid;

-- purchase_items
UPDATE "purchase_items" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'purchase_items' AND m.legacy_id = t.id;
UPDATE "purchase_items" t SET purchase_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'purchases' AND m.legacy_id = t.purchase_id;
UPDATE "purchase_items" t SET product_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'products' AND m.legacy_id = t.product_id;
ALTER TABLE "purchase_items"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "purchase_id" TYPE uuid USING purchase_id::uuid,
  ALTER COLUMN "product_id" TYPE uuid USING product_id::uuid;

-- stock_movements (reference es texto libre — puede contener ids legacy: remapear los que matcheen)
UPDATE "stock_movements" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'stock_movements' AND m.legacy_id = t.id;
UPDATE "stock_movements" t SET organization_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.organization_id;
UPDATE "stock_movements" t SET product_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'products' AND m.legacy_id = t.product_id;
UPDATE "stock_movements" t SET store_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'stores' AND m.legacy_id = t.store_id;
UPDATE "stock_movements" t SET user_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'users' AND m.legacy_id = t.user_id;
UPDATE "stock_movements" t SET reference = m.new_uuid::text FROM "legacy_id_map" m WHERE m.legacy_id = t.reference;
ALTER TABLE "stock_movements"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "organization_id" TYPE uuid USING organization_id::uuid,
  ALTER COLUMN "product_id" TYPE uuid USING product_id::uuid,
  ALTER COLUMN "store_id" TYPE uuid USING store_id::uuid,
  ALTER COLUMN "user_id" TYPE uuid USING user_id::uuid;

-- system_configs
UPDATE "system_configs" t SET id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'system_configs' AND m.legacy_id = t.id;
UPDATE "system_configs" t SET organization_id = m.new_uuid::text FROM "legacy_id_map" m WHERE m.entity = 'organizations' AND m.legacy_id = t.organization_id;
ALTER TABLE "system_configs"
  ALTER COLUMN "id" TYPE uuid USING id::uuid,
  ALTER COLUMN "id" SET DEFAULT uuidv7(),
  ALTER COLUMN "organization_id" TYPE uuid USING organization_id::uuid;

-- ============================================================
-- Recrear FKs (mismos nombres y acciones que antes)
-- ============================================================
ALTER TABLE "stores" ADD CONSTRAINT "stores_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "email_verifications" ADD CONSTRAINT "email_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "brands" ADD CONSTRAINT "brands_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unit_measures" ADD CONSTRAINT "unit_measures_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_unit_measure_id_fkey" FOREIGN KEY ("unit_measure_id") REFERENCES "unit_measures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_unit_measure_id_fkey" FOREIGN KEY ("unit_measure_id") REFERENCES "unit_measures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "system_configs" ADD CONSTRAINT "system_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
