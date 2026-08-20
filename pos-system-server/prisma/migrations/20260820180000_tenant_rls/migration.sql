-- Row-Level Security por tenant (Fase 1 paso 2g — Receta R3, skill postgresql-table-design).
--
-- Qué hace: habilita RLS y crea la policy tenant_isolation en toda tabla
-- tenant-scoped, keyed en current_setting('app.tenant_id') (seteada por request
-- con SET LOCAL dentro de la transacción). El escape superadmin usa
-- current_setting('app.is_superadmin').
--
-- Qué NO hace todavía (llega en Fase 2, cuando el server sea el único punto de
-- acceso a la DB y setee el tenant por request):
--   - FORCE ROW LEVEL SECURITY: el client strangler-fig conecta como owner y no
--     setea app.tenant_id; forzar RLS ahora lo dejaría sin filas. El owner
--     bypasea RLS mientras tanto (el filtro app-layer organizationId sigue
--     siendo la primera línea).
--   - CREATE ROLE pos_app / pos_migrator: los roles son cluster-scoped y sus
--     credenciales dependen del entorno — ver scripts/db/rls-roles.sql.
--
-- NULLIF(current_setting(..., true), '') devuelve NULL si la var no está seteada
-- o está vacía → la policy no matchea ninguna fila (falla cerrada, no error).

-- ============================================================
-- organizations: el tenant se identifica por su propio id
-- ============================================================
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "organizations"
  USING (
    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

-- ============================================================
-- Tablas con organization_id directo
-- ============================================================
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stores"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

-- users.organization_id es nullable (pre-onboarding): esas filas solo son
-- visibles para superadmin o flujos de auth (que en Fase 2 corren con la var
-- sin setear... y como owner/migrator hasta definir el rol de auth).
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "users"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "categories"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "brands"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

ALTER TABLE "unit_measures" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "unit_measures"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "products"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "customers"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "suppliers"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

ALTER TABLE "payment_methods" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payment_methods"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sales"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

ALTER TABLE "purchases" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchases"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "stock_movements"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

ALTER TABLE "system_configs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "system_configs"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "audit_logs"
  USING (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
    OR NULLIF(current_setting('app.is_superadmin', true), '')::boolean
  );

-- ============================================================
-- Tablas hijas sin organization_id: el tenant llega vía el padre.
-- El subquery sobre el padre también pasa por SU policy, así que la
-- visibilidad es consistente (fila hija visible ⟺ padre visible).
-- ============================================================
ALTER TABLE "sale_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sale_items"
  USING (EXISTS (SELECT 1 FROM "sales" s WHERE s.id = sale_id))
  WITH CHECK (EXISTS (SELECT 1 FROM "sales" s WHERE s.id = sale_id));

ALTER TABLE "sale_payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sale_payments"
  USING (EXISTS (SELECT 1 FROM "sales" s WHERE s.id = sale_id))
  WITH CHECK (EXISTS (SELECT 1 FROM "sales" s WHERE s.id = sale_id));

ALTER TABLE "purchase_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "purchase_items"
  USING (EXISTS (SELECT 1 FROM "purchases" p WHERE p.id = purchase_id))
  WITH CHECK (EXISTS (SELECT 1 FROM "purchases" p WHERE p.id = purchase_id));

-- NOTA: sessions / password_resets / email_verifications son user-scoped (sin
-- organization_id) y los flujos de auth corren antes de conocer el tenant —
-- quedan fuera de RLS a propósito. legacy_id_map es infraestructura de la
-- migración (solo el server la consulta durante la transición).
