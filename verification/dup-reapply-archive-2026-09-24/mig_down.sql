START TRANSACTION;

ALTER TABLE "Loans" DROP CONSTRAINT IF EXISTS "FK_Loans_Users_ArchivedByUserId";
DROP INDEX IF EXISTS "UX_Loans_CustomerId_ActiveApplication";
DROP INDEX IF EXISTS "IX_Loans_ArchivedByUserId";
DROP INDEX IF EXISTS "UX_Customers_PanNormalized";
DROP INDEX IF EXISTS "IX_Customers_PanNormalized";
DROP INDEX IF EXISTS "IX_Customers_PhoneNormalized";
DROP INDEX IF EXISTS "IX_Customers_EmailNormalized";
ALTER TABLE "Loans"
  DROP COLUMN IF EXISTS "ArchiveReason",
  DROP COLUMN IF EXISTS "ArchivedByUserId",
  DROP COLUMN IF EXISTS "ArchivedAt",
  DROP COLUMN IF EXISTS "IsArchived";
ALTER TABLE "Customers"
  DROP COLUMN IF EXISTS "EmailNormalized",
  DROP COLUMN IF EXISTS "PhoneNormalized",
  DROP COLUMN IF EXISTS "PanNormalized";


DELETE FROM "__EFMigrationsHistory"
WHERE "MigrationId" = '20260924143037_AddCustomerIdentityKeysAndApplicationArchive';

COMMIT;

