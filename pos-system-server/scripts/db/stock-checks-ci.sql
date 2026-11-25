-- CC-POS-09: run ONLY in the disposable pos_test CI database (after migrate + seed).
-- Checks that the CHECK constraints of 20261125000000_stock_and_amount_checks are
-- applied and validated, that they reject bad rows (and allow an ADJUSTMENT to 0, #51),
-- and that the revert (DROP CONSTRAINT) works and rolls back. Leaves no changes.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() <> 'pos_test' THEN
 RAISE EXCEPTION 'Stock checks CI target rejected'; END IF; END $$;

CREATE TEMP TABLE expected_checks (tbl text, name text);
INSERT INTO expected_checks VALUES
 ('products', 'products_current_stock_check'),
 ('products', 'products_cost_price_check'),
 ('products', 'products_sale_price_check'),
 ('sales', 'sales_subtotal_check'),
 ('sales', 'sales_total_check'),
 ('sale_items', 'sale_items_quantity_check'),
 ('sale_items', 'sale_items_unit_price_check'),
 ('sale_items', 'sale_items_subtotal_check'),
 ('sale_payments', 'sale_payments_amount_check'),
 ('purchases', 'purchases_total_check'),
 ('purchase_items', 'purchase_items_quantity_check'),
 ('purchase_items', 'purchase_items_unit_price_check'),
 ('purchase_items', 'purchase_items_subtotal_check'),
 ('stock_movements', 'stock_movements_quantity_check');

DO $$ DECLARE missing text; BEGIN
 SELECT string_agg(e.name, ', ') INTO missing FROM expected_checks e
 WHERE NOT EXISTS (
   SELECT 1 FROM pg_constraint c
   WHERE c.conname = e.name AND c.conrelid = ('public.' || e.tbl)::regclass
     AND c.contype = 'c' AND c.convalidated);
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'CHECK missing or not validated: %', missing; END IF;
END $$;
\echo 'Restricciones CHECK aplicadas y validadas'

SELECT p.id AS product_id, p.organization_id AS org_id FROM products p
JOIN organizations o ON o.id = p.organization_id
WHERE o.name = 'Pos Demo Org' AND p.is_deleted = false ORDER BY p.created_at LIMIT 1 \gset

BEGIN;
SELECT set_config('pos_ci.product', :'product_id', true) IS NOT NULL
   AND set_config('pos_ci.org', :'org_id', true) IS NOT NULL AS pos_ci_ctx \gset
DO $$
DECLARE
 product uuid := current_setting('pos_ci.product')::uuid;
 org uuid := current_setting('pos_ci.org')::uuid;
 rejected boolean;
BEGIN
 rejected := false;
 BEGIN UPDATE products SET current_stock = -1 WHERE id = product;
 EXCEPTION WHEN check_violation THEN rejected := true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Negative stock accepted'; END IF;

 rejected := false;
 BEGIN UPDATE products SET sale_price = -1 WHERE id = product;
 EXCEPTION WHEN check_violation THEN rejected := true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'Negative price accepted'; END IF;

 rejected := false;
 BEGIN
  INSERT INTO stock_movements (organization_id, product_id, type, quantity, previous_stock, new_stock)
  VALUES (org, product, 'OUT', 0, 0, 0);
 EXCEPTION WHEN check_violation THEN rejected := true; END;
 IF NOT rejected THEN RAISE EXCEPTION 'OUT movement of 0 accepted'; END IF;

 -- An ADJUSTMENT to 0 is a valid inventory count (#51).
 INSERT INTO stock_movements (organization_id, product_id, type, quantity, previous_stock, new_stock)
 VALUES (org, product, 'ADJUSTMENT', 0, 0, 0);
END $$;
\echo 'Stock negativo, precio negativo y salida de 0 rechazados; ajuste a 0 aceptado'

-- Revert (down) inside the transaction: the same bad rows become possible again.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT tbl, name FROM expected_checks LOOP
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.tbl, r.name);
 END LOOP;
END $$;
UPDATE products SET current_stock = -1 WHERE id = :'product_id';
\echo 'Revert (DROP CONSTRAINT) aplicado: stock negativo aceptado'
ROLLBACK;

DO $$ BEGIN
 IF (SELECT count(*) FROM pg_constraint c JOIN expected_checks e ON e.name = c.conname) <> (SELECT count(*) FROM expected_checks)
    OR EXISTS (SELECT 1 FROM products WHERE current_stock < 0)
 THEN RAISE EXCEPTION 'Constraints / rows did not survive rollback as expected'; END IF;
END $$;
\echo 'Rollback: restricciones presentes y sin cambios'
