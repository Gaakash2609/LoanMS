\pset footer off
\echo '-- head migration'
SELECT max("MigrationId") AS head FROM "__EFMigrationsHistory";
\echo '-- indexes present'
SELECT indexname FROM pg_indexes
 WHERE indexname IN ('UX_Customers_PanNormalized','IX_Customers_PanNormalized','UX_Loans_CustomerId_ActiveApplication',
                     'IX_Customers_PhoneNormalized','IX_Customers_EmailNormalized','IX_Loans_ArchivedByUserId')
 ORDER BY 1;
\echo '-- raw values untouched, normalised keys derived (legacy rows)'
SELECT "FullName", "PanNumber" AS raw_pan, "PanNormalized", "Phone" AS raw_phone, "PhoneNormalized", "Email" AS raw_email, "EmailNormalized", "IsDeleted"
  FROM "Customers" WHERE "FullName" LIKE 'L_ %' ORDER BY "Id";
\echo '-- RejectedAt backfill: L4 from exact history (~20d, not the 1d note); L5 stays NULL'
SELECT "LoanNumber", "RejectedAt", round(extract(epoch FROM now()-"RejectedAt")/86400) AS age_days
  FROM "Loans" WHERE "LoanNumber" IN ('LEG0004A','LEG0005A') ORDER BY 1;
\echo '-- archive columns defaulted'
SELECT count(*) AS loans, count(*) FILTER (WHERE "IsArchived") AS archived FROM "Loans";
