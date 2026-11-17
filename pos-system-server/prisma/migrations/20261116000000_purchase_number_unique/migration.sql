-- CC-POS-13: purchase numbers are unique per organization among live rows.
-- Partial unique index (same convention as 20260820130000_soft_delete_partial_uniques):
-- Prisma cannot express it, so it lives only in SQL and schema.prisma is unchanged.
-- Revert: DROP INDEX "purchases_organization_id_purchase_number_key";

-- Fail with a clear message instead of a generic index build error.
DO $$
DECLARE dup record;
BEGIN
  SELECT organization_id, purchase_number, count(*) AS n INTO dup
  FROM "purchases"
  WHERE "deleted_at" IS NULL
  GROUP BY organization_id, purchase_number
  HAVING count(*) > 1
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Duplicate live purchase_number % (% rows) in organization %; fix before migrating',
      dup.purchase_number, dup.n, dup.organization_id;
  END IF;
END $$;

CREATE UNIQUE INDEX "purchases_organization_id_purchase_number_key"
  ON "purchases"("organization_id", "purchase_number")
  WHERE "deleted_at" IS NULL;
