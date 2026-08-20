-- snake_case identifiers (Fase 1 paso 2a — skill postgresql-table-design).
-- Hand-written as RENAMEs: Prisma's generated diff would DROP+ADD columns and lose data.
-- Renames cover: columns, index names, FK constraint names, and enum type names,
-- so the database matches exactly what Prisma expects from the @map/@@map schema.

-- ============================================================
-- Enum types
-- ============================================================
ALTER TYPE "UserRole" RENAME TO "user_role";
ALTER TYPE "StockMovementType" RENAME TO "stock_movement_type";
ALTER TYPE "PaymentType" RENAME TO "payment_type";
ALTER TYPE "SaleStatus" RENAME TO "sale_status";
ALTER TYPE "PurchaseStatus" RENAME TO "purchase_status";
ALTER TYPE "AuditAction" RENAME TO "audit_action";

-- ============================================================
-- organizations
-- ============================================================
ALTER TABLE "organizations" RENAME COLUMN "taxId" TO "tax_id";
ALTER TABLE "organizations" RENAME COLUMN "isActive" TO "is_active";
ALTER TABLE "organizations" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "organizations" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "organizations" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "organizations" RENAME COLUMN "deletedAt" TO "deleted_at";

-- ============================================================
-- stores
-- ============================================================
ALTER TABLE "stores" RENAME COLUMN "organizationId" TO "organization_id";
ALTER TABLE "stores" RENAME COLUMN "saleNumberPrefix" TO "sale_number_prefix";
ALTER TABLE "stores" RENAME COLUMN "lastSaleNumber" TO "last_sale_number";
ALTER TABLE "stores" RENAME COLUMN "isActive" TO "is_active";
ALTER TABLE "stores" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "stores" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "stores" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "stores" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER INDEX "stores_organizationId_name_key" RENAME TO "stores_organization_id_name_key";
ALTER TABLE "stores" RENAME CONSTRAINT "stores_organizationId_fkey" TO "stores_organization_id_fkey";

-- ============================================================
-- users
-- ============================================================
ALTER TABLE "users" RENAME COLUMN "organizationId" TO "organization_id";
ALTER TABLE "users" RENAME COLUMN "storeId" TO "store_id";
ALTER TABLE "users" RENAME COLUMN "firstName" TO "first_name";
ALTER TABLE "users" RENAME COLUMN "lastName" TO "last_name";
ALTER TABLE "users" RENAME COLUMN "emailVerified" TO "email_verified";
ALTER TABLE "users" RENAME COLUMN "isActive" TO "is_active";
ALTER TABLE "users" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "users" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "users" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "users" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "users" RENAME COLUMN "lastLoginAt" TO "last_login_at";
ALTER TABLE "users" RENAME COLUMN "passwordChangedAt" TO "password_changed_at";
ALTER TABLE "users" RENAME COLUMN "loginAttempts" TO "login_attempts";
ALTER TABLE "users" RENAME COLUMN "lockedUntil" TO "locked_until";
ALTER INDEX "users_email_deletedAt_key" RENAME TO "users_email_deleted_at_key";
ALTER INDEX "users_username_deletedAt_key" RENAME TO "users_username_deleted_at_key";
ALTER INDEX "users_organizationId_isDeleted_isActive_idx" RENAME TO "users_organization_id_is_deleted_is_active_idx";
ALTER INDEX "users_email_isDeleted_idx" RENAME TO "users_email_is_deleted_idx";
ALTER INDEX "users_lastLoginAt_idx" RENAME TO "users_last_login_at_idx";
ALTER TABLE "users" RENAME CONSTRAINT "users_organizationId_fkey" TO "users_organization_id_fkey";
ALTER TABLE "users" RENAME CONSTRAINT "users_storeId_fkey" TO "users_store_id_fkey";

-- ============================================================
-- sessions
-- ============================================================
ALTER TABLE "sessions" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "sessions" RENAME COLUMN "expiresAt" TO "expires_at";
ALTER TABLE "sessions" RENAME COLUMN "ipAddress" TO "ip_address";
ALTER TABLE "sessions" RENAME COLUMN "userAgent" TO "user_agent";
ALTER TABLE "sessions" RENAME COLUMN "deviceId" TO "device_id";
ALTER TABLE "sessions" RENAME COLUMN "isActive" TO "is_active";
ALTER TABLE "sessions" RENAME COLUMN "revokedAt" TO "revoked_at";
ALTER TABLE "sessions" RENAME COLUMN "revokedBy" TO "revoked_by";
ALTER TABLE "sessions" RENAME COLUMN "lastActivityAt" TO "last_activity_at";
ALTER TABLE "sessions" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "sessions" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER INDEX "sessions_userId_isActive_idx" RENAME TO "sessions_user_id_is_active_idx";
ALTER INDEX "sessions_expiresAt_idx" RENAME TO "sessions_expires_at_idx";
ALTER INDEX "sessions_lastActivityAt_idx" RENAME TO "sessions_last_activity_at_idx";
ALTER TABLE "sessions" RENAME CONSTRAINT "sessions_userId_fkey" TO "sessions_user_id_fkey";

-- ============================================================
-- password_resets
-- ============================================================
ALTER TABLE "password_resets" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "password_resets" RENAME COLUMN "expiresAt" TO "expires_at";
ALTER TABLE "password_resets" RENAME COLUMN "usedAt" TO "used_at";
ALTER TABLE "password_resets" RENAME COLUMN "ipAddress" TO "ip_address";
ALTER TABLE "password_resets" RENAME COLUMN "userAgent" TO "user_agent";
ALTER TABLE "password_resets" RENAME COLUMN "createdAt" TO "created_at";
ALTER INDEX "password_resets_userId_used_idx" RENAME TO "password_resets_user_id_used_idx";
ALTER INDEX "password_resets_expiresAt_idx" RENAME TO "password_resets_expires_at_idx";
ALTER TABLE "password_resets" RENAME CONSTRAINT "password_resets_userId_fkey" TO "password_resets_user_id_fkey";

-- ============================================================
-- email_verifications
-- ============================================================
ALTER TABLE "email_verifications" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "email_verifications" RENAME COLUMN "expiresAt" TO "expires_at";
ALTER TABLE "email_verifications" RENAME COLUMN "verifiedAt" TO "verified_at";
ALTER TABLE "email_verifications" RENAME COLUMN "ipAddress" TO "ip_address";
ALTER TABLE "email_verifications" RENAME COLUMN "userAgent" TO "user_agent";
ALTER TABLE "email_verifications" RENAME COLUMN "createdAt" TO "created_at";
ALTER INDEX "email_verifications_userId_verified_idx" RENAME TO "email_verifications_user_id_verified_idx";
ALTER INDEX "email_verifications_expiresAt_idx" RENAME TO "email_verifications_expires_at_idx";
ALTER TABLE "email_verifications" RENAME CONSTRAINT "email_verifications_userId_fkey" TO "email_verifications_user_id_fkey";

-- ============================================================
-- audit_logs
-- ============================================================
ALTER TABLE "audit_logs" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "audit_logs" RENAME COLUMN "entityId" TO "entity_id";
ALTER TABLE "audit_logs" RENAME COLUMN "oldValues" TO "old_values";
ALTER TABLE "audit_logs" RENAME COLUMN "newValues" TO "new_values";
ALTER TABLE "audit_logs" RENAME COLUMN "ipAddress" TO "ip_address";
ALTER TABLE "audit_logs" RENAME COLUMN "userAgent" TO "user_agent";
ALTER TABLE "audit_logs" RENAME COLUMN "organizationId" TO "organization_id";
ALTER TABLE "audit_logs" RENAME COLUMN "createdAt" TO "created_at";
ALTER INDEX "audit_logs_userId_idx" RENAME TO "audit_logs_user_id_idx";
ALTER INDEX "audit_logs_entity_entityId_idx" RENAME TO "audit_logs_entity_entity_id_idx";
ALTER INDEX "audit_logs_organizationId_idx" RENAME TO "audit_logs_organization_id_idx";
ALTER INDEX "audit_logs_createdAt_idx" RENAME TO "audit_logs_created_at_idx";
ALTER TABLE "audit_logs" RENAME CONSTRAINT "audit_logs_userId_fkey" TO "audit_logs_user_id_fkey";

-- ============================================================
-- categories
-- ============================================================
ALTER TABLE "categories" RENAME COLUMN "organizationId" TO "organization_id";
ALTER TABLE "categories" RENAME COLUMN "isActive" TO "is_active";
ALTER TABLE "categories" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "categories" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "categories" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "categories" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER INDEX "categories_organizationId_name_deletedAt_key" RENAME TO "categories_organization_id_name_deleted_at_key";
ALTER TABLE "categories" RENAME CONSTRAINT "categories_organizationId_fkey" TO "categories_organization_id_fkey";

-- ============================================================
-- brands
-- ============================================================
ALTER TABLE "brands" RENAME COLUMN "organizationId" TO "organization_id";
ALTER TABLE "brands" RENAME COLUMN "isActive" TO "is_active";
ALTER TABLE "brands" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "brands" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "brands" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "brands" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER INDEX "brands_organizationId_name_deletedAt_key" RENAME TO "brands_organization_id_name_deleted_at_key";
ALTER TABLE "brands" RENAME CONSTRAINT "brands_organizationId_fkey" TO "brands_organization_id_fkey";

-- ============================================================
-- unit_measures
-- ============================================================
ALTER TABLE "unit_measures" RENAME COLUMN "organizationId" TO "organization_id";
ALTER TABLE "unit_measures" RENAME COLUMN "isActive" TO "is_active";
ALTER TABLE "unit_measures" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "unit_measures" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "unit_measures" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "unit_measures" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER INDEX "unit_measures_organizationId_name_deletedAt_key" RENAME TO "unit_measures_organization_id_name_deleted_at_key";
ALTER INDEX "unit_measures_organizationId_abbreviation_deletedAt_key" RENAME TO "unit_measures_organization_id_abbreviation_deleted_at_key";
ALTER TABLE "unit_measures" RENAME CONSTRAINT "unit_measures_organizationId_fkey" TO "unit_measures_organization_id_fkey";

-- ============================================================
-- products
-- ============================================================
ALTER TABLE "products" RENAME COLUMN "organizationId" TO "organization_id";
ALTER TABLE "products" RENAME COLUMN "categoryId" TO "category_id";
ALTER TABLE "products" RENAME COLUMN "brandId" TO "brand_id";
ALTER TABLE "products" RENAME COLUMN "unitMeasureId" TO "unit_measure_id";
ALTER TABLE "products" RENAME COLUMN "costPrice" TO "cost_price";
ALTER TABLE "products" RENAME COLUMN "salePrice" TO "sale_price";
ALTER TABLE "products" RENAME COLUMN "minStock" TO "min_stock";
ALTER TABLE "products" RENAME COLUMN "currentStock" TO "current_stock";
ALTER TABLE "products" RENAME COLUMN "alcoholGrade" TO "alcohol_grade";
ALTER TABLE "products" RENAME COLUMN "isActive" TO "is_active";
ALTER TABLE "products" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "products" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "products" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "products" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER INDEX "products_organizationId_barcode_deletedAt_key" RENAME TO "products_organization_id_barcode_deleted_at_key";
ALTER INDEX "products_organizationId_sku_deletedAt_key" RENAME TO "products_organization_id_sku_deleted_at_key";
ALTER TABLE "products" RENAME CONSTRAINT "products_organizationId_fkey" TO "products_organization_id_fkey";
ALTER TABLE "products" RENAME CONSTRAINT "products_categoryId_fkey" TO "products_category_id_fkey";
ALTER TABLE "products" RENAME CONSTRAINT "products_brandId_fkey" TO "products_brand_id_fkey";
ALTER TABLE "products" RENAME CONSTRAINT "products_unitMeasureId_fkey" TO "products_unit_measure_id_fkey";

-- ============================================================
-- customers
-- ============================================================
ALTER TABLE "customers" RENAME COLUMN "organizationId" TO "organization_id";
ALTER TABLE "customers" RENAME COLUMN "firstName" TO "first_name";
ALTER TABLE "customers" RENAME COLUMN "lastName" TO "last_name";
ALTER TABLE "customers" RENAME COLUMN "documentType" TO "document_type";
ALTER TABLE "customers" RENAME COLUMN "isActive" TO "is_active";
ALTER TABLE "customers" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "customers" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "customers" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "customers" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER INDEX "customers_organizationId_email_deletedAt_key" RENAME TO "customers_organization_id_email_deleted_at_key";
ALTER INDEX "customers_organizationId_document_deletedAt_key" RENAME TO "customers_organization_id_document_deleted_at_key";
ALTER TABLE "customers" RENAME CONSTRAINT "customers_organizationId_fkey" TO "customers_organization_id_fkey";

-- ============================================================
-- suppliers
-- ============================================================
ALTER TABLE "suppliers" RENAME COLUMN "organizationId" TO "organization_id";
ALTER TABLE "suppliers" RENAME COLUMN "contactName" TO "contact_name";
ALTER TABLE "suppliers" RENAME COLUMN "taxId" TO "tax_id";
ALTER TABLE "suppliers" RENAME COLUMN "isActive" TO "is_active";
ALTER TABLE "suppliers" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "suppliers" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "suppliers" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "suppliers" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER INDEX "suppliers_organizationId_taxId_deletedAt_key" RENAME TO "suppliers_organization_id_tax_id_deleted_at_key";
ALTER TABLE "suppliers" RENAME CONSTRAINT "suppliers_organizationId_fkey" TO "suppliers_organization_id_fkey";

-- ============================================================
-- payment_methods
-- ============================================================
ALTER TABLE "payment_methods" RENAME COLUMN "organizationId" TO "organization_id";
ALTER TABLE "payment_methods" RENAME COLUMN "isActive" TO "is_active";
ALTER TABLE "payment_methods" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "payment_methods" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "payment_methods" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "payment_methods" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER INDEX "payment_methods_organizationId_name_deletedAt_key" RENAME TO "payment_methods_organization_id_name_deleted_at_key";
ALTER TABLE "payment_methods" RENAME CONSTRAINT "payment_methods_organizationId_fkey" TO "payment_methods_organization_id_fkey";

-- ============================================================
-- sales
-- ============================================================
ALTER TABLE "sales" RENAME COLUMN "organizationId" TO "organization_id";
ALTER TABLE "sales" RENAME COLUMN "storeId" TO "store_id";
ALTER TABLE "sales" RENAME COLUMN "saleNumber" TO "sale_number";
ALTER TABLE "sales" RENAME COLUMN "customerId" TO "customer_id";
ALTER TABLE "sales" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "sales" RENAME COLUMN "saleDate" TO "sale_date";
ALTER TABLE "sales" RENAME COLUMN "dueDate" TO "due_date";
ALTER TABLE "sales" RENAME COLUMN "paidDate" TO "paid_date";
ALTER TABLE "sales" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "sales" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "sales" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "sales" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER INDEX "sales_storeId_saleNumber_deletedAt_key" RENAME TO "sales_store_id_sale_number_deleted_at_key";
ALTER TABLE "sales" RENAME CONSTRAINT "sales_customerId_fkey" TO "sales_customer_id_fkey";
ALTER TABLE "sales" RENAME CONSTRAINT "sales_storeId_fkey" TO "sales_store_id_fkey";
ALTER TABLE "sales" RENAME CONSTRAINT "sales_userId_fkey" TO "sales_user_id_fkey";

-- ============================================================
-- sale_items
-- ============================================================
ALTER TABLE "sale_items" RENAME COLUMN "saleId" TO "sale_id";
ALTER TABLE "sale_items" RENAME COLUMN "productId" TO "product_id";
ALTER TABLE "sale_items" RENAME COLUMN "unitMeasureId" TO "unit_measure_id";
ALTER TABLE "sale_items" RENAME COLUMN "unitPrice" TO "unit_price";
ALTER TABLE "sale_items" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "sale_items" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "sale_items" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "sale_items" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "sale_items" RENAME CONSTRAINT "sale_items_saleId_fkey" TO "sale_items_sale_id_fkey";
ALTER TABLE "sale_items" RENAME CONSTRAINT "sale_items_productId_fkey" TO "sale_items_product_id_fkey";
ALTER TABLE "sale_items" RENAME CONSTRAINT "sale_items_unitMeasureId_fkey" TO "sale_items_unit_measure_id_fkey";

-- ============================================================
-- sale_payments
-- ============================================================
ALTER TABLE "sale_payments" RENAME COLUMN "saleId" TO "sale_id";
ALTER TABLE "sale_payments" RENAME COLUMN "paymentMethodId" TO "payment_method_id";
ALTER TABLE "sale_payments" RENAME COLUMN "paymentDate" TO "payment_date";
ALTER TABLE "sale_payments" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "sale_payments" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "sale_payments" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "sale_payments" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "sale_payments" RENAME CONSTRAINT "sale_payments_saleId_fkey" TO "sale_payments_sale_id_fkey";
ALTER TABLE "sale_payments" RENAME CONSTRAINT "sale_payments_paymentMethodId_fkey" TO "sale_payments_payment_method_id_fkey";

-- ============================================================
-- purchases
-- ============================================================
ALTER TABLE "purchases" RENAME COLUMN "organizationId" TO "organization_id";
ALTER TABLE "purchases" RENAME COLUMN "supplierId" TO "supplier_id";
ALTER TABLE "purchases" RENAME COLUMN "purchaseNumber" TO "purchase_number";
ALTER TABLE "purchases" RENAME COLUMN "purchaseDate" TO "purchase_date";
ALTER TABLE "purchases" RENAME COLUMN "receivedDate" TO "received_date";
ALTER TABLE "purchases" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "purchases" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "purchases" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "purchases" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "purchases" RENAME CONSTRAINT "purchases_supplierId_fkey" TO "purchases_supplier_id_fkey";

-- ============================================================
-- purchase_items
-- ============================================================
ALTER TABLE "purchase_items" RENAME COLUMN "purchaseId" TO "purchase_id";
ALTER TABLE "purchase_items" RENAME COLUMN "productId" TO "product_id";
ALTER TABLE "purchase_items" RENAME COLUMN "unitPrice" TO "unit_price";
ALTER TABLE "purchase_items" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "purchase_items" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "purchase_items" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "purchase_items" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER TABLE "purchase_items" RENAME CONSTRAINT "purchase_items_purchaseId_fkey" TO "purchase_items_purchase_id_fkey";
ALTER TABLE "purchase_items" RENAME CONSTRAINT "purchase_items_productId_fkey" TO "purchase_items_product_id_fkey";

-- ============================================================
-- stock_movements
-- ============================================================
ALTER TABLE "stock_movements" RENAME COLUMN "organizationId" TO "organization_id";
ALTER TABLE "stock_movements" RENAME COLUMN "productId" TO "product_id";
ALTER TABLE "stock_movements" RENAME COLUMN "storeId" TO "store_id";
ALTER TABLE "stock_movements" RENAME COLUMN "previousStock" TO "previous_stock";
ALTER TABLE "stock_movements" RENAME COLUMN "newStock" TO "new_stock";
ALTER TABLE "stock_movements" RENAME COLUMN "userId" TO "user_id";
ALTER TABLE "stock_movements" RENAME COLUMN "createdAt" TO "created_at";
ALTER INDEX "stock_movements_organizationId_productId_createdAt_idx" RENAME TO "stock_movements_organization_id_product_id_created_at_idx";
ALTER TABLE "stock_movements" RENAME CONSTRAINT "stock_movements_organizationId_fkey" TO "stock_movements_organization_id_fkey";
ALTER TABLE "stock_movements" RENAME CONSTRAINT "stock_movements_productId_fkey" TO "stock_movements_product_id_fkey";
ALTER TABLE "stock_movements" RENAME CONSTRAINT "stock_movements_userId_fkey" TO "stock_movements_user_id_fkey";

-- ============================================================
-- system_configs
-- ============================================================
ALTER TABLE "system_configs" RENAME COLUMN "organizationId" TO "organization_id";
ALTER TABLE "system_configs" RENAME COLUMN "isDeleted" TO "is_deleted";
ALTER TABLE "system_configs" RENAME COLUMN "createdAt" TO "created_at";
ALTER TABLE "system_configs" RENAME COLUMN "updatedAt" TO "updated_at";
ALTER TABLE "system_configs" RENAME COLUMN "deletedAt" TO "deleted_at";
ALTER INDEX "system_configs_organizationId_key_deletedAt_key" RENAME TO "system_configs_organization_id_key_deleted_at_key";
ALTER TABLE "system_configs" RENAME CONSTRAINT "system_configs_organizationId_fkey" TO "system_configs_organization_id_fkey";
