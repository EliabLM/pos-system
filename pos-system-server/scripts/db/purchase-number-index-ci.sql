-- CC-POS-13: run ONLY in the disposable pos_test CI database (after migrate + seed).
-- Checks that the partial unique index on purchases(organization_id, purchase_number)
-- is applied, rejects live duplicates, ignores soft-deleted rows, and that its revert
-- (DROP INDEX) works and rolls back. Leaves no rows and the index in place.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() <> 'pos_test' THEN
 RAISE EXCEPTION 'Purchase number index CI target rejected'; END IF; END $$;
DO $$ BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_index i
   JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'purchases_organization_id_purchase_number_key'
     AND i.indrelid = 'public.purchases'::regclass
     AND i.indisunique
     AND pg_get_indexdef(i.indexrelid) LIKE '%(organization_id, purchase_number)%'
     AND pg_get_expr(i.indpred, i.indrelid) = '(deleted_at IS NULL)')
 THEN RAISE EXCEPTION 'Partial unique index on purchases(organization_id, purchase_number) missing'; END IF;
END $$;
\echo 'Índice único parcial de purchase_number aplicado'
SELECT o.id AS org_a, s.id AS supplier_a
FROM organizations o JOIN suppliers s ON s.organization_id = o.id
WHERE o.name = 'Pos Demo Org' ORDER BY s.created_at LIMIT 1 \gset
BEGIN;
SELECT set_config('pos_ci.org_a', :'org_a', true) IS NOT NULL AND set_config('pos_ci.supplier_a', :'supplier_a', true) IS NOT NULL AS pos_ci_ctx \gset
INSERT INTO purchases (organization_id, supplier_id, purchase_number, total, updated_at)
VALUES (:'org_a', :'supplier_a', 'COMP-CI-DUP-0001', 0, now());
-- Soft-deleted rows do not count for uniqueness.
INSERT INTO purchases (organization_id, supplier_id, purchase_number, total, is_deleted, deleted_at, updated_at)
VALUES (:'org_a', :'supplier_a', 'COMP-CI-DUP-0001', 0, true, now(), now());
DO $$ DECLARE rejected boolean := false; BEGIN
 BEGIN
  INSERT INTO purchases (organization_id, supplier_id, purchase_number, total, updated_at)
  VALUES (current_setting('pos_ci.org_a')::uuid, current_setting('pos_ci.supplier_a')::uuid, 'COMP-CI-DUP-0001', 0, now());
 EXCEPTION WHEN unique_violation THEN rejected := true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Live duplicate purchase_number accepted'; END IF;
END $$;
-- Revert (down) inside the transaction: duplicates become possible again.
DROP INDEX purchases_organization_id_purchase_number_key;
INSERT INTO purchases (organization_id, supplier_id, purchase_number, total, updated_at)
VALUES (:'org_a', :'supplier_a', 'COMP-CI-DUP-0001', 0, now());
\echo 'Duplicado vivo rechazado, soft-delete ignorado, revert (DROP INDEX) aplicado'
ROLLBACK;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'purchases_organization_id_purchase_number_key')
    OR EXISTS (SELECT 1 FROM purchases WHERE purchase_number LIKE 'COMP-CI-DUP-%')
 THEN RAISE EXCEPTION 'Index / rows did not survive rollback as expected'; END IF;
END $$;
\echo 'Rollback: índice presente y sin filas de prueba'
