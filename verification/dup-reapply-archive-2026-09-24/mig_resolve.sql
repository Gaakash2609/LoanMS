-- Simulated admin resolution of the rows the report listed (no merge):
-- 1. L1: the lowercase record carried a mistyped PAN — corrected.
UPDATE "Customers" SET "PanNumber" = 'LGCYQ1234A' WHERE "Email" = 'l1.lower@legacy.test';
-- 2. L3: one of the two parallel applications was a duplicate — closed.
UPDATE "Loans" SET "Status" = 'Closed', "ClosedAt" = now() WHERE "LoanNumber" = 'LEG0003A';
-- 3. Older duplicate drafts already present in the copied DB — discarded the
--    way the app discards a draft (soft delete); the newest stays.
UPDATE "Loans" l SET "IsDeleted" = true
 WHERE l."Status" = 'Draft' AND l."IsDeleted" = false
   AND EXISTS (SELECT 1 FROM "Loans" o
                WHERE o."CustomerId" = l."CustomerId" AND o."Id" <> l."Id" AND o."IsDeleted" = false
                  AND o."Status" NOT IN ('Rejected','Closed')
                  AND (o."Status" <> 'Draft' OR o."Id" > l."Id"));
