-- Money: double precision → numeric(12,2) (Fase 1 paso 2e — Receta R2).
-- ROUND explícito: los floats binarios guardan 0.1 de forma imprecisa; al castear
-- se redondea a 2 decimales (comportamiento correcto, no pérdida — ver R2).
-- Antes de correr contra datos de producción: auditar el impacto con
--   SELECT id, total FROM sales WHERE total::numeric != ROUND(total::numeric, 2);
-- Quantities (Int) y medidas (alcohol_grade, volume) NO cambian.

ALTER TABLE "products"
  ALTER COLUMN "cost_price" TYPE numeric(12,2) USING ROUND("cost_price"::numeric, 2),
  ALTER COLUMN "sale_price" TYPE numeric(12,2) USING ROUND("sale_price"::numeric, 2);

ALTER TABLE "sales"
  ALTER COLUMN "subtotal" TYPE numeric(12,2) USING ROUND("subtotal"::numeric, 2),
  ALTER COLUMN "total" TYPE numeric(12,2) USING ROUND("total"::numeric, 2);

ALTER TABLE "sale_items"
  ALTER COLUMN "unit_price" TYPE numeric(12,2) USING ROUND("unit_price"::numeric, 2),
  ALTER COLUMN "subtotal" TYPE numeric(12,2) USING ROUND("subtotal"::numeric, 2);

ALTER TABLE "sale_payments"
  ALTER COLUMN "amount" TYPE numeric(12,2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "purchases"
  ALTER COLUMN "total" TYPE numeric(12,2) USING ROUND("total"::numeric, 2);

ALTER TABLE "purchase_items"
  ALTER COLUMN "unit_price" TYPE numeric(12,2) USING ROUND("unit_price"::numeric, 2),
  ALTER COLUMN "subtotal" TYPE numeric(12,2) USING ROUND("subtotal"::numeric, 2);
