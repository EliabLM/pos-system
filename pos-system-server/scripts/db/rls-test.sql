-- Test de aislamiento RLS (DoD Fase 1: "un tenant no ve filas de otro").
-- Correr como owner contra la DB local (crea datos temporales y hace ROLLBACK):
--
--   psql "$DATABASE_URL" -f scripts/db/rls-test.sql
--
-- Requiere el rol pos_app (scripts/db/rls-roles.sql). Usa SET ROLE para asumir
-- el rol non-owner dentro de la transacción — con ROLLBACK al final no queda rastro.

\set ON_ERROR_STOP on

BEGIN;

-- Datos de dos tenants
INSERT INTO organizations (id, name, email, updated_at) VALUES
  ('00000000-0000-7000-8000-00000000000a', 'RLS Test Org A', 'a@rls.test', now()),
  ('00000000-0000-7000-8000-00000000000b', 'RLS Test Org B', 'b@rls.test', now());
INSERT INTO categories (organization_id, name, updated_at) VALUES
  ('00000000-0000-7000-8000-00000000000a', 'rls-cat-A', now()),
  ('00000000-0000-7000-8000-00000000000b', 'rls-cat-B', now());

-- Asumir el rol non-owner (sujeto a RLS)
SET LOCAL ROLE pos_app;

-- 1. Sin tenant seteado → cero filas (falla cerrada)
SET LOCAL app.tenant_id = '';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM categories;
  IF n <> 0 THEN RAISE EXCEPTION 'RLS FAIL: sin tenant se ven % filas', n; END IF;
END $$;

-- 2. Tenant A → solo filas de A
SET LOCAL app.tenant_id = '00000000-0000-7000-8000-00000000000a';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM categories WHERE name LIKE 'rls-cat-%';
  IF n <> 1 THEN RAISE EXCEPTION 'RLS FAIL: tenant A ve % filas (esperaba 1)', n; END IF;
  SELECT count(*) INTO n FROM categories WHERE name = 'rls-cat-B';
  IF n <> 0 THEN RAISE EXCEPTION 'RLS FAIL: tenant A ve filas de B'; END IF;
END $$;

-- 3. WITH CHECK: tenant A no puede insertar filas de B
DO $$
BEGIN
  BEGIN
    INSERT INTO categories (organization_id, name, updated_at)
    VALUES ('00000000-0000-7000-8000-00000000000b', 'rls-cat-B2', now());
    RAISE EXCEPTION 'RLS FAIL: tenant A insertó una fila de B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL; -- esperado: la policy WITH CHECK rechaza el insert
  END;
END $$;

-- 4. Superadmin ve todo
SET LOCAL app.is_superadmin = 'true';
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM categories WHERE name LIKE 'rls-cat-%';
  IF n <> 2 THEN RAISE EXCEPTION 'RLS FAIL: superadmin ve % filas (esperaba 2)', n; END IF;
END $$;

RESET ROLE;
ROLLBACK;

\echo '✅ RLS: aislamiento de tenant verificado (sin tenant=0 filas, tenant A no ve B, WITH CHECK rechaza cross-tenant, superadmin ve todo)'
