-- DB-level guarantees, straight SQL (bypassing the app). Each statement runs on
-- its own; expected failures are printed, not fatal.
\echo '-- a) second ACTIVE application for L3 (expect: unique violation UX_Loans_CustomerId_ActiveApplication)'
INSERT INTO "Loans" ("LoanNumber","LoanType","Status","RequestedAmount","InterestRate","TenureMonths","CustomerId","CreatedByUserId","CreatedAt","IsDeleted")
SELECT 'LEGDUP1','Personal','Submitted',1,1,1,"Id",1,now(),false FROM "Customers" WHERE "Email" = 'l3@legacy.test';
\echo '-- b) extra REJECTED application for L3 (expect: allowed)'
INSERT INTO "Loans" ("LoanNumber","LoanType","Status","RequestedAmount","InterestRate","TenureMonths","CustomerId","CreatedByUserId","CreatedAt","IsDeleted")
SELECT 'LEGOK01','Personal','Rejected',1,1,1,"Id",1,now(),false FROM "Customers" WHERE "Email" = 'l3@legacy.test';
\echo '-- c) soft-deleted extra ACTIVE application for L3 (expect: allowed — outside the guarantee)'
INSERT INTO "Loans" ("LoanNumber","LoanType","Status","RequestedAmount","InterestRate","TenureMonths","CustomerId","CreatedByUserId","CreatedAt","IsDeleted")
SELECT 'LEGOK02','Personal','Draft',1,1,1,"Id",1,now(),true FROM "Customers" WHERE "Email" = 'l3@legacy.test';
\echo '-- d) customer with a duplicate normalised PAN (expect: unique violation UX_Customers_PanNormalized)'
INSERT INTO "Customers" ("FullName","Email","Phone","PanNumber","PanNormalized","CreatedAt","IsDeleted")
VALUES ('dup','dup.pan@legacy.test','9000000001','dupac1234d','DUPAC1234D',now(),false);
\echo '-- e) two customers with NO PAN (expect: allowed)'
INSERT INTO "Customers" ("FullName","Email","Phone","CreatedAt","IsDeleted")
VALUES ('nopan1','np1@legacy.test','9000000002',now(),false),('nopan2','np2@legacy.test','9000000003',now(),false);
\echo '-- f) resulting L3 applications'
SELECT "LoanNumber","Status","IsDeleted" FROM "Loans" WHERE "CustomerId" = (SELECT "Id" FROM "Customers" WHERE "Email"='l3@legacy.test') ORDER BY 1;
