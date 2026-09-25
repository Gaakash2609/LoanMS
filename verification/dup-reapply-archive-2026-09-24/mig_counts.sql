\pset footer off
SELECT (SELECT count(*) FROM "Customers") AS customers, (SELECT count(*) FROM "Loans") AS loans,
       (SELECT count(*) FROM "LoanStatusHistories") AS history,
       (SELECT count(*) FROM information_schema.columns WHERE table_name IN ('Customers','Loans')
          AND column_name IN ('PanNormalized','PhoneNormalized','EmailNormalized','IsArchived','ArchivedAt','ArchivedByUserId','ArchiveReason')) AS new_columns,
       (SELECT count(*) FROM "__EFMigrationsHistory" WHERE "MigrationId" LIKE '20260924143037%') AS migration_rows,
       (SELECT count(*) FROM pg_indexes WHERE indexname IN ('UX_Customers_PanNormalized','UX_Loans_CustomerId_ActiveApplication')) AS unique_guards;
