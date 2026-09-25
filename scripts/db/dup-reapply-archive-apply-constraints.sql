-- LoanMS — create the unique guarantees the migration had to skip because of
-- legacy duplicates. Run ONLY after dup-reapply-archive-report.sql sections 1
-- and 4 come back empty (an admin has reviewed and resolved those rows — this
-- script never merges, deletes or edits data). Idempotent; if duplicates still
-- exist it stops with an error and changes nothing.
BEGIN;

-- Re-derive the normalised identity keys from the raw columns first (same
-- rules as the migration / Customer.Normalize*), so rows corrected directly in
-- SQL are judged on their corrected values. Derived data only.
UPDATE "Customers" SET
  "PanNormalized" = CASE
      WHEN upper(btrim(coalesce("PanNumber", ''), E' \t\r\n')) ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'
      THEN upper(btrim("PanNumber", E' \t\r\n')) END,
  "PhoneNormalized" = CASE
      WHEN length(regexp_replace(coalesce("Phone", ''), '[^0-9]', '', 'g')) >= 10
      THEN right(regexp_replace("Phone", '[^0-9]', '', 'g'), 10) END,
  "EmailNormalized" = CASE
      WHEN lower(btrim(coalesce("Email", ''), E' \t\r\n')) LIKE '%@%'
       AND lower(btrim("Email", E' \t\r\n')) NOT LIKE '%@efin.auto'
      THEN lower(btrim("Email", E' \t\r\n')) END;

DO $$
DECLARE
  dup_pan    integer;
  dup_active integer;
BEGIN
  SELECT count(*) INTO dup_pan FROM (
    SELECT "PanNormalized" FROM "Customers"
     WHERE "PanNormalized" IS NOT NULL
     GROUP BY "PanNormalized" HAVING count(*) > 1) d;
  SELECT count(*) INTO dup_active FROM (
    SELECT "CustomerId" FROM "Loans"
     WHERE "IsDeleted" = false AND "Status" NOT IN ('Rejected', 'Closed')
     GROUP BY "CustomerId" HAVING count(*) > 1) d;

  IF dup_pan > 0 OR dup_active > 0 THEN
    RAISE EXCEPTION 'Not applied: % shared PAN value(s), % customer(s) with >1 active application remain. Resolve them first (see dup-reapply-archive-report.sql).', dup_pan, dup_active;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS "UX_Customers_PanNormalized"
    ON "Customers" ("PanNormalized") WHERE "PanNormalized" IS NOT NULL;
  DROP INDEX IF EXISTS "IX_Customers_PanNormalized";
  CREATE UNIQUE INDEX IF NOT EXISTS "UX_Loans_CustomerId_ActiveApplication"
    ON "Loans" ("CustomerId") WHERE "IsDeleted" = false AND "Status" NOT IN ('Rejected', 'Closed');
  RAISE NOTICE 'Unique guarantees in place.';
END $$;

COMMIT;
