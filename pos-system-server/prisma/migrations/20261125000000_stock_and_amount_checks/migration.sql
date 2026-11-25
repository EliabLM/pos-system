-- CC-POS-09: CHECK constraints for stock, quantities and amounts.
-- Prisma cannot express CHECK constraints: they live only in SQL and schema.prisma is
-- unchanged (same convention as the partial unique indexes).
-- Each one is added NOT VALID and then VALIDATEd (a bad existing row fails the migration
-- naming the constraint). Prisma runs this file as one unit, so the ACCESS EXCLUSIVE lock
-- of each ADD CONSTRAINT is held until the end and VALIDATE scans the table under it:
-- the split does not shorten the lock here (irrelevant at current table sizes). To keep
-- writes flowing on big tables, move the VALIDATE statements to a later migration.
-- stock_movements.quantity allows 0 only for ADJUSTMENT (an inventory count to 0, #51).
-- Revert: ALTER TABLE "<table>" DROP CONSTRAINT "<name>"; for each constraint below.
--
-- Before deploying, count the rows that would fail each CHECK (all must be 0; otherwise
-- fix the data first, the migration aborts and nothing is applied):
--   SELECT 'products' AS t, count(*) FROM products WHERE current_stock < 0 OR cost_price < 0 OR sale_price < 0
--   UNION ALL SELECT 'sales', count(*) FROM sales WHERE subtotal < 0 OR total < 0
--   UNION ALL SELECT 'sale_items', count(*) FROM sale_items WHERE quantity <= 0 OR unit_price < 0 OR subtotal < 0
--   UNION ALL SELECT 'sale_payments', count(*) FROM sale_payments WHERE amount < 0
--   UNION ALL SELECT 'purchases', count(*) FROM purchases WHERE total < 0
--   UNION ALL SELECT 'purchase_items', count(*) FROM purchase_items WHERE quantity <= 0 OR unit_price < 0 OR subtotal < 0
--   UNION ALL SELECT 'stock_movements', count(*) FROM stock_movements
--     WHERE NOT (quantity > 0 OR (type = 'ADJUSTMENT' AND quantity >= 0));

ALTER TABLE "products" ADD CONSTRAINT "products_current_stock_check" CHECK ("current_stock" >= 0) NOT VALID;
ALTER TABLE "products" ADD CONSTRAINT "products_cost_price_check" CHECK ("cost_price" >= 0) NOT VALID;
ALTER TABLE "products" ADD CONSTRAINT "products_sale_price_check" CHECK ("sale_price" >= 0) NOT VALID;
ALTER TABLE "sales" ADD CONSTRAINT "sales_subtotal_check" CHECK ("subtotal" >= 0) NOT VALID;
ALTER TABLE "sales" ADD CONSTRAINT "sales_total_check" CHECK ("total" >= 0) NOT VALID;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_quantity_check" CHECK ("quantity" > 0) NOT VALID;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_unit_price_check" CHECK ("unit_price" >= 0) NOT VALID;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_subtotal_check" CHECK ("subtotal" >= 0) NOT VALID;
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_amount_check" CHECK ("amount" >= 0) NOT VALID;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_total_check" CHECK ("total" >= 0) NOT VALID;
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_quantity_check" CHECK ("quantity" > 0) NOT VALID;
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_unit_price_check" CHECK ("unit_price" >= 0) NOT VALID;
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_subtotal_check" CHECK ("subtotal" >= 0) NOT VALID;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_check"
  CHECK ("quantity" > 0 OR ("type" = 'ADJUSTMENT' AND "quantity" >= 0)) NOT VALID;

ALTER TABLE "products" VALIDATE CONSTRAINT "products_current_stock_check";
ALTER TABLE "products" VALIDATE CONSTRAINT "products_cost_price_check";
ALTER TABLE "products" VALIDATE CONSTRAINT "products_sale_price_check";
ALTER TABLE "sales" VALIDATE CONSTRAINT "sales_subtotal_check";
ALTER TABLE "sales" VALIDATE CONSTRAINT "sales_total_check";
ALTER TABLE "sale_items" VALIDATE CONSTRAINT "sale_items_quantity_check";
ALTER TABLE "sale_items" VALIDATE CONSTRAINT "sale_items_unit_price_check";
ALTER TABLE "sale_items" VALIDATE CONSTRAINT "sale_items_subtotal_check";
ALTER TABLE "sale_payments" VALIDATE CONSTRAINT "sale_payments_amount_check";
ALTER TABLE "purchases" VALIDATE CONSTRAINT "purchases_total_check";
ALTER TABLE "purchase_items" VALIDATE CONSTRAINT "purchase_items_quantity_check";
ALTER TABLE "purchase_items" VALIDATE CONSTRAINT "purchase_items_unit_price_check";
ALTER TABLE "purchase_items" VALIDATE CONSTRAINT "purchase_items_subtotal_check";
ALTER TABLE "stock_movements" VALIDATE CONSTRAINT "stock_movements_quantity_check";
