-- Legacy-shaped problem rows, inserted into a COPY of an existing DB with the
-- PRE-migration schema (no normalised columns yet).
INSERT INTO "Customers" ("FullName","Email","Phone","PanNumber","CreatedAt","IsDeleted") VALUES
 ('L1 Legacy Upper','l1.upper@legacy.test','9811111111','LGCYP1234A', now()-interval '300 days', false),
 ('L1 Legacy Lower','l1.lower@legacy.test','+91 98111 11112','lgcyp1234a', now()-interval '200 days', false),
 ('L2 Phone FmtA','l2a@legacy.test','+91 98222 22222',NULL, now()-interval '100 days', false),
 ('L2 Phone FmtB','l2b@legacy.test','09822222222',NULL, now()-interval '90 days', false),
 ('L3 Double Active','l3@legacy.test','9844444444','DUPAC1234D', now()-interval '80 days', false),
 ('L4 History Only','l4@legacy.test','9855555555','HISTR1234H', now()-interval '70 days', false),
 ('L5 Unknown Date','l5@legacy.test','9866666666','UNKNW1234U', now()-interval '60 days', false),
 ('L6 Soft Deleted','l6@legacy.test','9833333333','DELET1234E', now()-interval '50 days', true),
 ('L7 Mixed Email','Mixed.Case@Legacy.TEST','9877777777',NULL, now()-interval '40 days', false),
 ('L7 Lower Email','mixed.case@legacy.test','9877777778',NULL, now()-interval '30 days', false);

INSERT INTO "Loans" ("LoanNumber","LoanType","Status","RequestedAmount","InterestRate","TenureMonths","CustomerId","CreatedByUserId","CreatedAt","IsDeleted","RejectedAt")
SELECT v.num, 'Personal', v.st, 100000, 12, 24, c."Id", 1, now()-interval '90 days', false, NULL
  FROM (VALUES ('LEG0003A','Submitted','l3@legacy.test'),
               ('LEG0003B','UnderReview','l3@legacy.test'),
               ('LEG0004A','Rejected','l4@legacy.test'),
               ('LEG0005A','Rejected','l5@legacy.test')) v(num, st, email)
  JOIN "Customers" c ON c."Email" = v.email;

-- L4: exact rejection transition 20 days ago + a later same-status NOTE that must NOT count.
INSERT INTO "LoanStatusHistories" ("LoanId","FromStatus","ToStatus","Comment","ChangedByUserId","CreatedAt","IsDeleted")
SELECT l."Id", 'UnderReview', 'Rejected', 'legacy reject', 1, now()-interval '20 days', false FROM "Loans" l WHERE l."LoanNumber"='LEG0004A'
UNION ALL
SELECT l."Id", 'Rejected', 'Rejected', 'lender RM updated', 1, now()-interval '1 day', false FROM "Loans" l WHERE l."LoanNumber"='LEG0004A';
