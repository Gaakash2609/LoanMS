START TRANSACTION;

ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS "PanNormalized" character varying(10);
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS "PhoneNormalized" character varying(10);
ALTER TABLE "Customers" ADD COLUMN IF NOT EXISTS "EmailNormalized" character varying(200);
ALTER TABLE "Loans" ADD COLUMN IF NOT EXISTS "IsArchived" boolean NOT NULL DEFAULT false;
ALTER TABLE "Loans" ADD COLUMN IF NOT EXISTS "ArchivedAt" timestamp with time zone;
ALTER TABLE "Loans" ADD COLUMN IF NOT EXISTS "ArchivedByUserId" integer;
ALTER TABLE "Loans" ADD COLUMN IF NOT EXISTS "ArchiveReason" character varying(500);



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



UPDATE "Loans" l
   SET "RejectedAt" = h.last_rejected
  FROM (SELECT "LoanId", max("CreatedAt") AS last_rejected
          FROM "LoanStatusHistories"
         WHERE "ToStatus" = 'Rejected' AND "FromStatus" <> 'Rejected'
         GROUP BY "LoanId") h
 WHERE l."Id" = h."LoanId"
   AND l."Status" = 'Rejected'
   AND l."RejectedAt" IS NULL;



CREATE INDEX IF NOT EXISTS "IX_Customers_PhoneNormalized" ON "Customers" ("PhoneNormalized");
CREATE INDEX IF NOT EXISTS "IX_Customers_EmailNormalized" ON "Customers" ("EmailNormalized");
CREATE INDEX IF NOT EXISTS "IX_Loans_ArchivedByUserId" ON "Loans" ("ArchivedByUserId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FK_Loans_Users_ArchivedByUserId') THEN
    ALTER TABLE "Loans" ADD CONSTRAINT "FK_Loans_Users_ArchivedByUserId"
      FOREIGN KEY ("ArchivedByUserId") REFERENCES "Users" ("Id") ON DELETE SET NULL;
  END IF;
END $$;

DO $$
DECLARE
  dup_pan     integer;
  dup_active  integer;
  unknown_rej integer;
BEGIN
  SELECT count(*) INTO dup_pan FROM (
    SELECT "PanNormalized" FROM "Customers"
     WHERE "PanNormalized" IS NOT NULL
     GROUP BY "PanNormalized" HAVING count(*) > 1) d;
  IF dup_pan = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "UX_Customers_PanNormalized"
      ON "Customers" ("PanNormalized") WHERE "PanNormalized" IS NOT NULL;
  ELSE
    CREATE INDEX IF NOT EXISTS "IX_Customers_PanNormalized" ON "Customers" ("PanNormalized");
    RAISE WARNING 'LoanMS AddCustomerIdentityKeysAndApplicationArchive: % PAN value(s) are shared by more than one customer. UX_Customers_PanNormalized was NOT created and nothing was merged. Review scripts/db/dup-reapply-archive-report.sql, resolve, then run scripts/db/dup-reapply-archive-apply-constraints.sql.', dup_pan;
  END IF;

  SELECT count(*) INTO dup_active FROM (
    SELECT "CustomerId" FROM "Loans"
     WHERE "IsDeleted" = false AND "Status" NOT IN ('Rejected', 'Closed')
     GROUP BY "CustomerId" HAVING count(*) > 1) d;
  IF dup_active = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "UX_Loans_CustomerId_ActiveApplication"
      ON "Loans" ("CustomerId") WHERE "IsDeleted" = false AND "Status" NOT IN ('Rejected', 'Closed');
  ELSE
    RAISE WARNING 'LoanMS AddCustomerIdentityKeysAndApplicationArchive: % customer(s) already have more than one active application. UX_Loans_CustomerId_ActiveApplication was NOT created and no application was changed. Review scripts/db/dup-reapply-archive-report.sql, resolve, then run scripts/db/dup-reapply-archive-apply-constraints.sql.', dup_active;
  END IF;

  SELECT count(*) INTO unknown_rej FROM "Loans"
   WHERE "Status" = 'Rejected' AND "RejectedAt" IS NULL;
  IF unknown_rej > 0 THEN
    RAISE WARNING 'LoanMS AddCustomerIdentityKeysAndApplicationArchive: % rejected application(s) have no recorded rejection date (no RejectedAt, no status history). New applications for those customers are blocked for admin review; see scripts/db/dup-reapply-archive-report.sql.', unknown_rej;
  END IF;
END $$;


INSERT INTO "__EFMigrationsHistory" ("MigrationId", "ProductVersion")
VALUES ('20260924143037_AddCustomerIdentityKeysAndApplicationArchive', '10.0.0');

COMMIT;

