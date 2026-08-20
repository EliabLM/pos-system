-- FK + tenant-leading indexes (Fase 1 paso 2d — skill postgresql-table-design).
-- Postgres does NOT auto-index FK columns; the soft-delete partial uniques from
-- 2b only index live rows for the constraint, so tenant-scoped list queries get
-- explicit (organization_id, is_deleted) composites here.

-- users
CREATE INDEX "users_store_id_idx" ON "users"("store_id");

-- categories / brands / unit_measures / payment_methods / system_configs
CREATE INDEX "categories_organization_id_is_deleted_idx" ON "categories"("organization_id", "is_deleted");
CREATE INDEX "brands_organization_id_is_deleted_idx" ON "brands"("organization_id", "is_deleted");
CREATE INDEX "unit_measures_organization_id_is_deleted_idx" ON "unit_measures"("organization_id", "is_deleted");
CREATE INDEX "payment_methods_organization_id_is_deleted_idx" ON "payment_methods"("organization_id", "is_deleted");
CREATE INDEX "system_configs_organization_id_is_deleted_idx" ON "system_configs"("organization_id", "is_deleted");

-- products
CREATE INDEX "products_organization_id_is_deleted_idx" ON "products"("organization_id", "is_deleted");
CREATE INDEX "products_category_id_idx" ON "products"("category_id");
CREATE INDEX "products_brand_id_idx" ON "products"("brand_id");
CREATE INDEX "products_unit_measure_id_idx" ON "products"("unit_measure_id");

-- customers / suppliers
CREATE INDEX "customers_organization_id_is_deleted_idx" ON "customers"("organization_id", "is_deleted");
CREATE INDEX "suppliers_organization_id_is_deleted_idx" ON "suppliers"("organization_id", "is_deleted");

-- sales
CREATE INDEX "sales_organization_id_is_deleted_sale_date_idx" ON "sales"("organization_id", "is_deleted", "sale_date");
CREATE INDEX "sales_store_id_idx" ON "sales"("store_id");
CREATE INDEX "sales_customer_id_idx" ON "sales"("customer_id");
CREATE INDEX "sales_user_id_idx" ON "sales"("user_id");

-- sale_items / sale_payments
CREATE INDEX "sale_items_sale_id_idx" ON "sale_items"("sale_id");
CREATE INDEX "sale_items_product_id_idx" ON "sale_items"("product_id");
CREATE INDEX "sale_items_unit_measure_id_idx" ON "sale_items"("unit_measure_id");
CREATE INDEX "sale_payments_sale_id_idx" ON "sale_payments"("sale_id");
CREATE INDEX "sale_payments_payment_method_id_idx" ON "sale_payments"("payment_method_id");

-- purchases / purchase_items
CREATE INDEX "purchases_organization_id_is_deleted_purchase_date_idx" ON "purchases"("organization_id", "is_deleted", "purchase_date");
CREATE INDEX "purchases_supplier_id_idx" ON "purchases"("supplier_id");
CREATE INDEX "purchase_items_purchase_id_idx" ON "purchase_items"("purchase_id");
CREATE INDEX "purchase_items_product_id_idx" ON "purchase_items"("product_id");

-- stock_movements
CREATE INDEX "stock_movements_product_id_idx" ON "stock_movements"("product_id");
CREATE INDEX "stock_movements_user_id_idx" ON "stock_movements"("user_id");
CREATE INDEX "stock_movements_store_id_idx" ON "stock_movements"("store_id");

-- stores
CREATE INDEX "stores_organization_id_is_deleted_idx" ON "stores"("organization_id", "is_deleted");
