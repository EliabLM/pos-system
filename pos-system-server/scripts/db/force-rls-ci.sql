-- POS-03c: run ONLY in the disposable pos_test CI database, after P0.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() <> 'pos_test' THEN
 RAISE EXCEPTION 'FORCE RLS CI target rejected'; END IF; END $$;
DO $$ BEGIN
  IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.categories'::regclass)
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.categories'::regclass)
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'categories' AND policyname = 'tenant_isolation')
    OR NOT (SELECT r.rolsuper FROM pg_roles r WHERE r.rolname = current_user)
    OR (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.categories'::regclass) <> current_user
  THEN RAISE EXCEPTION 'Unexpected owner, policy, RLS flags or CI service role'; END IF;
END $$;
\echo 'RLS baseline: owner superuser, policy enabled, FORCE off'
SELECT id AS org_a FROM organizations WHERE name = 'Pos Demo Org' \gset
SELECT id AS org_b FROM organizations WHERE name = 'Pos Isolation Org' \gset
BEGIN;
CREATE ROLE pos_ci_rls_probe NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO pos_ci_rls_probe;
GRANT SELECT, INSERT ON categories TO pos_ci_rls_probe;
GRANT pos_ci_rls_probe TO CURRENT_USER;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.categories'::regclass)
    OR NOT (SELECT r.rolname <> pg_get_userbyid(c.relowner) AND NOT r.rolsuper AND NOT r.rolbypassrls
            FROM pg_roles r CROSS JOIN pg_class c WHERE r.rolname = 'pos_ci_rls_probe' AND c.oid = 'public.categories'::regclass)
 THEN RAISE EXCEPTION 'FORCE or non-owner role missing'; END IF;
END $$;
SET LOCAL ROLE pos_ci_rls_probe;
SELECT set_config('app.tenant_id', '', true);
DO $$ BEGIN IF (SELECT count(*) FROM categories) <> 0 THEN RAISE EXCEPTION 'No context leaked rows'; END IF; END $$;
SELECT set_config('app.tenant_id', :'org_a', true);
DO $$ BEGIN
 IF (SELECT count(*) FROM categories) <> 3 OR (SELECT count(*) FROM categories WHERE name = 'Bebidas') <> 1
 THEN RAISE EXCEPTION 'Tenant A visibility failed'; END IF;
END $$;
SELECT set_config('pos_ci.org_b', :'org_b', true);
DO $$ DECLARE rejected boolean := false; BEGIN
 BEGIN
  INSERT INTO categories (organization_id, name, updated_at)
  VALUES (current_setting('pos_ci.org_b')::uuid, 'cross-tenant-ci-rejected', now());
 EXCEPTION WHEN insufficient_privilege OR check_violation THEN rejected := true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Cross-tenant write accepted'; END IF;
END $$;
SELECT set_config('app.tenant_id', :'org_b', true);
DO $$ BEGIN
 IF (SELECT count(*) FROM categories) <> 1 OR (SELECT count(*) FROM categories WHERE name = 'Bebidas') <> 1
 THEN RAISE EXCEPTION 'Tenant B visibility failed'; END IF;
END $$;
\echo 'RLS transaccional: sin contexto 0, A 3, B 1, escritura A->B denegada; FORCE activo solo dentro de esta transacción'
RESET ROLE;
ROLLBACK;
DO $$ BEGIN
 IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.categories'::regclass)
    OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_ci_rls_probe')
    OR EXISTS (SELECT 1 FROM categories WHERE name = 'cross-tenant-ci-rejected')
 THEN RAISE EXCEPTION 'FORCE / role / row survived rollback'; END IF;
END $$;
\echo 'RLS cleanup: FORCE off, ephemeral role absent, no test rows'
