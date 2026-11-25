-- CC-POS-09: CHECK constraints for stock, quantities and amounts.
-- Prisma cannot express CHECK constraints: they live only in SQL and schema.prisma is
-- unchanged (same convention as the partial unique indexes).
-- Each one is added NOT VALID (short lock, only new rows are checked) and then
-- VALIDATEd (existing rows; a bad row fails the migration naming the constraint).
-- stock_movements.quantity allows 0 only for ADJUSTMENT (an inventory count to 0, #51).
-- Revert: ALTER TABLE "<table>" DROP CONSTRAINT "<name>"; for each constraint below.

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
