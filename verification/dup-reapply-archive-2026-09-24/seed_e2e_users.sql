-- Extra users for the E2E run (password = the seeded admin's, Admin@123). Idempotent.
DELETE FROM "Locations" l WHERE l."Code" LIKE 'E2E%'
   AND l."Id" <> (SELECT min(x."Id") FROM "Locations" x WHERE x."Code" = l."Code")
   AND NOT EXISTS (SELECT 1 FROM "Users" u WHERE u."LocationId" = l."Id");
INSERT INTO "Locations" ("Name","City","State","Code","IsActive","CreatedAt","IsDeleted")
SELECT v.n, v.c, v.s, v.code, true, now(), false
  FROM (VALUES ('E2E Pune','Pune','MH','E2EPUN'), ('E2E Delhi','Delhi','DL','E2EDEL')) v(n, c, s, code)
 WHERE NOT EXISTS (SELECT 1 FROM "Locations" x WHERE x."Code" = v.code);

INSERT INTO "Users" ("FullName","Email","PasswordHash","Role","IsActive","CreatedAt","IsDeleted","LocationId","EmployeeCode","MustChangePassword","FailedLoginAttempts")
SELECT v.name, v.email, a."PasswordHash", v.role, true, now(), false,
       (SELECT min("Id") FROM "Locations" WHERE "Code" = 'E2EPUN'), v.code, false, 0
  FROM (VALUES ('E2E Risk Officer','risk@e2e.test','ProductTeam','E2E-PT1'),
               ('E2E Zonal Manager','zonal@e2e.test','LocationHead','E2E-LH1'),
               ('E2E Other Sales','sales2@e2e.test','Sales','E2E-SA2')) v(name, email, role, code)
 CROSS JOIN (SELECT "PasswordHash" FROM "Users" WHERE "Email" = 'admin@efin.com') a
 WHERE NOT EXISTS (SELECT 1 FROM "Users" u WHERE u."Email" = v.email);

INSERT INTO "UserLocations" ("UserId","LocationId","CreatedAt","IsDeleted")
SELECT u."Id", (SELECT min("Id") FROM "Locations" WHERE "Code" = 'E2EPUN'), now(), false FROM "Users" u
 WHERE u."Email" = 'zonal@e2e.test'
   AND NOT EXISTS (SELECT 1 FROM "UserLocations" x WHERE x."UserId" = u."Id");

SELECT "Id","Email","Role","LocationId" FROM "Users" ORDER BY "Id";
SELECT "Id","Code" FROM "Locations" WHERE "Code" LIKE 'E2E%' ORDER BY "Id";
