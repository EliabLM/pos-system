-- Soft-delete uniqueness via partial unique indexes (Fase 1 paso 2b).
-- Replaces the @@unique([..., deletedAt]) workaround: uniqueness now applies only
-- to live rows (WHERE deleted_at IS NULL), so names/codes can be reused after a
-- soft delete without indexing tombstones. Prisma cannot express partial indexes,
-- so these live only in SQL; its diff engine ignores them (verified empirically).

-- users
DROP INDEX "users_email_deleted_at_key";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email") WHERE "deleted_at" IS NULL;
DROP INDEX "users_username_deleted_at_key";
CREATE UNIQUE INDEX "users_username_key" ON "users"("username") WHERE "deleted_at" IS NULL;

-- stores (previously a FULL unique without deleted_at — it blocked name reuse after soft delete)
DROP INDEX "stores_organization_id_name_key";
CREATE UNIQUE INDEX "stores_organization_id_name_key" ON "stores"("organization_id", "name") WHERE "deleted_at" IS NULL;

-- categories
DROP INDEX "categories_organization_id_name_deleted_at_key";
CREATE UNIQUE INDEX "categories_organization_id_name_key" ON "categories"("organization_id", "name") WHERE "deleted_at" IS NULL;

-- brands
DROP INDEX "brands_organization_id_name_deleted_at_key";
CREATE UNIQUE INDEX "brands_organization_id_name_key" ON "brands"("organization_id", "name") WHERE "deleted_at" IS NULL;

-- unit_measures
DROP INDEX "unit_measures_organization_id_name_deleted_at_key";
CREATE UNIQUE INDEX "unit_measures_organization_id_name_key" ON "unit_measures"("organization_id", "name") WHERE "deleted_at" IS NULL;
DROP INDEX "unit_measures_organization_id_abbreviation_deleted_at_key";
CREATE UNIQUE INDEX "unit_measures_organization_id_abbreviation_key" ON "unit_measures"("organization_id", "abbreviation") WHERE "deleted_at" IS NULL;

-- products (barcode/sku are nullable: multiple NULLs remain allowed, as before)
DROP INDEX "products_organization_id_barcode_deleted_at_key";
CREATE UNIQUE INDEX "products_organization_id_barcode_key" ON "products"("organization_id", "barcode") WHERE "deleted_at" IS NULL;
DROP INDEX "products_organization_id_sku_deleted_at_key";
CREATE UNIQUE INDEX "products_organization_id_sku_key" ON "products"("organization_id", "sku") WHERE "deleted_at" IS NULL;

-- customers
DROP INDEX "customers_organization_id_email_deleted_at_key";
CREATE UNIQUE INDEX "customers_organization_id_email_key" ON "customers"("organization_id", "email") WHERE "deleted_at" IS NULL;
DROP INDEX "customers_organization_id_document_deleted_at_key";
CREATE UNIQUE INDEX "customers_organization_id_document_key" ON "customers"("organization_id", "document") WHERE "deleted_at" IS NULL;

-- suppliers
DROP INDEX "suppliers_organization_id_tax_id_deleted_at_key";
CREATE UNIQUE INDEX "suppliers_organization_id_tax_id_key" ON "suppliers"("organization_id", "tax_id") WHERE "deleted_at" IS NULL;

-- payment_methods
DROP INDEX "payment_methods_organization_id_name_deleted_at_key";
CREATE UNIQUE INDEX "payment_methods_organization_id_name_key" ON "payment_methods"("organization_id", "name") WHERE "deleted_at" IS NULL;

-- sales
DROP INDEX "sales_store_id_sale_number_deleted_at_key";
CREATE UNIQUE INDEX "sales_store_id_sale_number_key" ON "sales"("store_id", "sale_number") WHERE "deleted_at" IS NULL;

-- system_configs
DROP INDEX "system_configs_organization_id_key_deleted_at_key";
CREATE UNIQUE INDEX "system_configs_organization_id_key_key" ON "system_configs"("organization_id", "key") WHERE "deleted_at" IS NULL;
