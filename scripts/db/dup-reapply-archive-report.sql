-- LoanMS — customer duplicate / re-application / archive: legacy-data report.
-- READ-ONLY. Safe to run against production (psql -f). Changes nothing.
--
-- Run AFTER migration 20260924143037_AddCustomerIdentityKeysAndApplicationArchive
-- (it needs the normalised identity columns). Each section lists the rows an
-- admin must review; nothing is ever merged or fixed automatically.
\echo '== 0. Unique guarantees present? (missing = legacy duplicates below must be resolved first)'
SELECT i.relname AS index_name, ix.indisunique AS is_unique
  FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid
 WHERE i.relname IN ('UX_Customers_PanNormalized', 'IX_Customers_PanNormalized',
                     'UX_Loans_CustomerId_ActiveApplication')
 ORDER BY 1;

\echo '== 1. Customers sharing one normalised PAN (blocks UX_Customers_PanNormalized)'
SELECT "PanNormalized", count(*) AS customers,
       string_agg("Id"::text || CASE WHEN "IsDeleted" THEN '(deleted)' ELSE '' END, ', ' ORDER BY "Id") AS customer_ids
  FROM "Customers"
 WHERE "PanNormalized" IS NOT NULL
 GROUP BY "PanNormalized" HAVING count(*) > 1
 ORDER BY customers DESC, 1;

\echo '== 2. Customers sharing one normalised mobile (allowed — shared family phones — but a new application matching several is sent to admin review)'
SELECT "PhoneNormalized", count(*) AS customers,
       string_agg("Id"::text || CASE WHEN "IsDeleted" THEN '(deleted)' ELSE '' END, ', ' ORDER BY "Id") AS customer_ids
  FROM "Customers"
 WHERE "PhoneNormalized" IS NOT NULL
 GROUP BY "PhoneNormalized" HAVING count(*) > 1
 ORDER BY customers DESC, 1;

\echo '== 3. Customers sharing one normalised email (differs only by case/spaces)'
SELECT "EmailNormalized", count(*) AS customers,
       string_agg("Id"::text || CASE WHEN "IsDeleted" THEN '(deleted)' ELSE '' END, ', ' ORDER BY "Id") AS customer_ids
  FROM "Customers"
 WHERE "EmailNormalized" IS NOT NULL
 GROUP BY "EmailNormalized" HAVING count(*) > 1
 ORDER BY customers DESC, 1;

\echo '== 4. Customers with more than one ACTIVE application (blocks UX_Loans_CustomerId_ActiveApplication)'
SELECT l."CustomerId", count(*) AS active_applications,
       string_agg(l."LoanNumber" || ':' || l."Status", ', ' ORDER BY l."CreatedAt") AS applications
  FROM "Loans" l
 WHERE l."IsDeleted" = false AND l."Status" NOT IN ('Rejected', 'Closed')
 GROUP BY l."CustomerId" HAVING count(*) > 1
 ORDER BY active_applications DESC, 1;

\echo '== 5. Rejected applications with NO recorded rejection date (new applications for these customers are blocked: admin review)'
SELECT l."Id", l."LoanNumber", l."CustomerId", l."IsDeleted", l."IsArchived", l."CreatedAt", l."UpdatedAt"
  FROM "Loans" l
 WHERE l."Status" = 'Rejected' AND l."RejectedAt" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "LoanStatusHistories" h
                    WHERE h."LoanId" = l."Id" AND h."ToStatus" = 'Rejected' AND h."FromStatus" <> 'Rejected')
 ORDER BY l."Id";

\echo '== 6. Rejected applications whose RejectedAt is OLDER than their last history transition into Rejected (runtime uses the later one)'
SELECT l."Id", l."LoanNumber", l."RejectedAt", max(h."CreatedAt") AS last_history_rejection
  FROM "Loans" l
  JOIN "LoanStatusHistories" h ON h."LoanId" = l."Id" AND h."ToStatus" = 'Rejected' AND h."FromStatus" <> 'Rejected'
 WHERE l."Status" = 'Rejected' AND l."RejectedAt" IS NOT NULL
 GROUP BY l."Id", l."LoanNumber", l."RejectedAt"
HAVING max(h."CreatedAt") > l."RejectedAt"
 ORDER BY l."Id";

\echo '== 7. Soft-deleted customers (a new application matching one is sent to admin review, never silently restored)'
SELECT count(*) AS soft_deleted_customers FROM "Customers" WHERE "IsDeleted" = true;

\echo '== 8. Customers whose PAN / mobile is present but not usable as an identifier (bad format)'
SELECT count(*) FILTER (WHERE coalesce(btrim("PanNumber"), '') <> '' AND "PanNormalized" IS NULL) AS invalid_pan,
       count(*) FILTER (WHERE coalesce(btrim("Phone"), '') <> '' AND "PhoneNormalized" IS NULL)   AS invalid_mobile
  FROM "Customers";

\echo '== 9. Summary'
SELECT (SELECT count(*) FROM "Customers")                                              AS customers,
       (SELECT count(*) FROM "Loans")                                                  AS applications,
       (SELECT count(*) FROM "Loans" WHERE "Status" = 'Rejected')                      AS rejected,
       (SELECT count(*) FROM "Loans" WHERE "Status" = 'Rejected' AND "RejectedAt" IS NULL) AS rejected_without_rejectedat,
       (SELECT count(*) FROM "Loans" WHERE "IsArchived")                               AS archived;
