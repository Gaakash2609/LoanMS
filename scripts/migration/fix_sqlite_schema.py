#!/usr/bin/env python3
"""
Fixes the LoanMS local SQLite dev database (LoanMS.API/loanms.db) so its
schema matches the current EF Core model.

WHY THIS SCRIPT EXISTS (root cause):
  Program.cs uses db.Database.EnsureCreated() for SQLite (dev), not
  MigrateAsync(). EnsureCreated() only builds the schema the FIRST time the
  db file doesn't exist -- on every later run, if the file already exists,
  it is a total no-op, even if the C# model has grown new columns/tables
  since. Your loanms.db was created before 11 later migrations were added
  to the model, so those columns/tables were never added to the physical
  file. That's why EF's generated SQL now references u.AddressCity and the
  column truly isn't there.

  Separately: those 11 migrations (20260811000000_AddLoanSalesTeamAndOpsManager
  through 20260813020000_AddTeamIsActive) are written as raw PostgreSQL SQL
  (SERIAL, "timestamp with time zone", "ADD COLUMN IF NOT EXISTS", etc.) for
  the production RDS deployment. That syntax is invalid in SQLite (confirmed
  by testing "ADD COLUMN IF NOT EXISTS" directly -- SQLite rejects it), so
  they were never meant to run via `dotnet ef database update` against
  SQLite, and doing so would fail immediately on the first one.

  This script applies the *same logical schema changes* as those 11
  migrations, using SQLite-compatible DDL, directly against your existing
  loanms.db file. It only ADDS columns/tables -- nothing is dropped,
  renamed, or overwritten, so all existing data is preserved.

USAGE:
    python3 fix_sqlite_schema.py path/to/loanms.db

Safe to re-run: every operation checks first and skips anything already
present.
"""
import sqlite3
import sys
import shutil
import os
from datetime import datetime


def column_exists(cur, table, column):
    cur.execute(f'PRAGMA table_info("{table}")')
    return any(row[1] == column for row in cur.fetchall())


def table_exists(cur, table):
    cur.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
    )
    return cur.fetchone() is not None


def add_column(cur, table, column, coltype, log):
    if column_exists(cur, table, column):
        log.append(f"  SKIP  {table}.{column} already exists")
        return
    cur.execute(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {coltype}')
    log.append(f"  ADDED {table}.{column} {coltype}")


def create_table(cur, table, ddl, log):
    if table_exists(cur, table):
        log.append(f"  SKIP  table {table} already exists")
        return
    cur.executescript(ddl)
    log.append(f"  CREATED table {table}")


def create_index(cur, index_name, ddl, log):
    cur.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
        (index_name,),
    )
    if cur.fetchone():
        log.append(f"  SKIP  index {index_name} already exists")
        return
    cur.executescript(ddl)
    log.append(f"  CREATED index {index_name}")


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 fix_sqlite_schema.py path/to/loanms.db")
        sys.exit(1)

    db_path = sys.argv[1]
    if not os.path.isfile(db_path):
        print(f"File not found: {db_path}")
        sys.exit(1)

    backup_path = f"{db_path}.bak.{datetime.now():%Y%m%d%H%M%S}"
    shutil.copy2(db_path, backup_path)
    print(f"Backup written to: {backup_path}")

    con = sqlite3.connect(db_path)
    cur = con.cursor()
    log = []

    # ── 20260811000000_AddLoanSalesTeamAndOpsManager ───────────────────────
    add_column(cur, "Loans", "SalesTeamName", "TEXT", log)
    add_column(cur, "Loans", "OpsManagerId", "INTEGER", log)
    create_index(
        cur,
        "IX_Loans_OpsManagerId",
        'CREATE INDEX "IX_Loans_OpsManagerId" ON "Loans" ("OpsManagerId");',
        log,
    )
    # Note: SQLite cannot add a FK constraint via ALTER TABLE ADD COLUMN
    # (would require a full table rebuild). EF does not require a physical
    # FK constraint to generate correct queries -- it uses its own model
    # metadata -- so this is safe to skip for a local dev database.

    # ── 20260811010000_AddLoanBankLines ─────────────────────────────────────
    create_table(
        cur,
        "LoanBankLines",
        '''
        CREATE TABLE "LoanBankLines" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_LoanBankLines" PRIMARY KEY AUTOINCREMENT,
            "LoanId" INTEGER NOT NULL,
            "BankName" TEXT NOT NULL DEFAULT '',
            "TempApplicationNumber" TEXT NOT NULL DEFAULT '',
            "ApplicationNumber" TEXT NULL,
            "ApprovedLoan" decimal(18,2) NULL,
            "Remarks" TEXT NULL,
            "CreatedAt" TEXT NOT NULL,
            "UpdatedAt" TEXT NULL,
            "IsDeleted" INTEGER NOT NULL DEFAULT 0,
            CONSTRAINT "FK_LoanBankLines_Loans_LoanId" FOREIGN KEY ("LoanId") REFERENCES "Loans" ("Id") ON DELETE CASCADE
        );
        ''',
        log,
    )
    create_index(
        cur,
        "IX_LoanBankLines_LoanId",
        'CREATE INDEX "IX_LoanBankLines_LoanId" ON "LoanBankLines" ("LoanId");',
        log,
    )

    # ── 20260812000000_AddPerfiosReports ────────────────────────────────────
    create_table(
        cur,
        "PerfiosReports",
        '''
        CREATE TABLE "PerfiosReports" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_PerfiosReports" PRIMARY KEY AUTOINCREMENT,
            "LoanId" INTEGER NOT NULL,
            "FileName" TEXT NULL,
            "AverageBankBalance" TEXT NULL,
            "Span" TEXT NULL,
            "TotalTransactions" INTEGER NULL,
            "HasSalary" INTEGER NOT NULL DEFAULT 0,
            "IsValid" INTEGER NOT NULL DEFAULT 0,
            "FirstTransactionDate" TEXT NULL,
            "LastTransactionDate" TEXT NULL,
            "ManualReviewRequired" INTEGER NOT NULL DEFAULT 0,
            "StaleDays" INTEGER NULL,
            "VerifiedAt" TEXT NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            "UpdatedAt" TEXT NULL,
            "IsDeleted" INTEGER NOT NULL DEFAULT 0,
            CONSTRAINT "FK_PerfiosReports_Loans_LoanId" FOREIGN KEY ("LoanId") REFERENCES "Loans" ("Id") ON DELETE CASCADE
        );
        ''',
        log,
    )
    create_index(
        cur,
        "IX_PerfiosReports_LoanId",
        'CREATE INDEX "IX_PerfiosReports_LoanId" ON "PerfiosReports" ("LoanId");',
        log,
    )

    # ── 20260812010000_AddBankLoanTypesPinsHomeTypes ────────────────────────
    add_column(cur, "Banks", "LoanTypesJson", "TEXT", log)
    add_column(cur, "Banks", "ServiceablePinsJson", "TEXT", log)
    add_column(cur, "Banks", "HomeTypesJson", "TEXT", log)

    # ── 20260812020000_AddBankProductRules ──────────────────────────────────
    create_table(
        cur,
        "BankProductRules",
        '''
        CREATE TABLE "BankProductRules" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_BankProductRules" PRIMARY KEY AUTOINCREMENT,
            "BankId" INTEGER NOT NULL,
            "ProductKey" TEXT NOT NULL,
            "MinCibil" INTEGER NULL,
            "AcceptNtc" INTEGER NOT NULL DEFAULT 0,
            "MaxLoanAmt" decimal(18,2) NULL,
            "MinTenure" INTEGER NULL,
            "MaxTenure" INTEGER NULL,
            "FoirLimit" INTEGER NULL,
            "PfRequired" INTEGER NOT NULL DEFAULT 0,
            "MinAge" INTEGER NULL,
            "MaxAge" INTEGER NULL,
            "MinExpMonths" INTEGER NULL,
            "EmpTypesJson" TEXT NOT NULL DEFAULT '[]',
            "CompTypesJson" TEXT NOT NULL DEFAULT '[]',
            "HomeTypesJson" TEXT NOT NULL DEFAULT '[]',
            "CreatedAt" TEXT NOT NULL,
            "UpdatedAt" TEXT NULL,
            "IsDeleted" INTEGER NOT NULL DEFAULT 0,
            CONSTRAINT "FK_BankProductRules_Banks_BankId" FOREIGN KEY ("BankId") REFERENCES "Banks" ("Id") ON DELETE CASCADE
        );
        ''',
        log,
    )
    create_index(
        cur,
        "IX_BankProductRules_BankId_ProductKey",
        'CREATE UNIQUE INDEX "IX_BankProductRules_BankId_ProductKey" ON "BankProductRules" ("BankId", "ProductKey");',
        log,
    )

    # ── 20260812030000_AddUserAddressBankFields (the immediate crash cause) ─
    add_column(cur, "Users", "AddressLine1", "TEXT", log)
    add_column(cur, "Users", "AddressLine2", "TEXT", log)
    add_column(cur, "Users", "AddressCity", "TEXT", log)
    add_column(cur, "Users", "AddressState", "TEXT", log)
    add_column(cur, "Users", "AddressPostalCode", "TEXT", log)
    add_column(cur, "Users", "BankAccountHolderName", "TEXT", log)
    add_column(cur, "Users", "BankName", "TEXT", log)
    add_column(cur, "Users", "BankAccountType", "TEXT", log)
    add_column(cur, "Users", "BankAccountNumber", "TEXT", log)
    add_column(cur, "Users", "BankIfscCode", "TEXT", log)

    # ── 20260812040000_AddLoanSanctionDetails ───────────────────────────────
    create_table(
        cur,
        "LoanSanctionDetails",
        '''
        CREATE TABLE "LoanSanctionDetails" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_LoanSanctionDetails" PRIMARY KEY AUTOINCREMENT,
            "LoanId" INTEGER NOT NULL,
            "StampDuty" TEXT NULL,
            "Gst" decimal(18,2) NULL,
            "Insurance" decimal(18,2) NULL,
            "PfPercent" decimal(5,2) NULL,
            "InsuranceInBundled" INTEGER NOT NULL DEFAULT 0,
            "PfInBundled" INTEGER NOT NULL DEFAULT 0,
            "IsBundled" INTEGER NOT NULL DEFAULT 0,
            "IsBt" INTEGER NOT NULL DEFAULT 0,
            "FlatRate" decimal(5,2) NULL,
            "EmiDate" TEXT NULL,
            "CreatedAt" TEXT NOT NULL,
            "UpdatedAt" TEXT NULL,
            "IsDeleted" INTEGER NOT NULL DEFAULT 0,
            CONSTRAINT "FK_LoanSanctionDetails_Loans_LoanId" FOREIGN KEY ("LoanId") REFERENCES "Loans" ("Id") ON DELETE CASCADE
        );
        ''',
        log,
    )
    create_index(
        cur,
        "IX_LoanSanctionDetails_LoanId",
        'CREATE UNIQUE INDEX "IX_LoanSanctionDetails_LoanId" ON "LoanSanctionDetails" ("LoanId");',
        log,
    )

    # ── 20260812050000_AddLoanProductDataJson ───────────────────────────────
    add_column(cur, "Loans", "ProductDataJson", "TEXT", log)

    # ── 20260813000000_AddEmployeeCodeAndLocationCode ──────────────────────
    add_column(cur, "Locations", "Code", "TEXT NOT NULL DEFAULT ''", log)
    if column_exists(cur, "Locations", "Code"):
        cur.execute(
            '''UPDATE "Locations"
               SET "Code" = UPPER(SUBSTR(REPLACE(REPLACE("Name",' ',''),'.',''),1,3))
               WHERE "Code" IS NULL OR "Code" = ''' + "''"
        )
    add_column(cur, "Users", "EmployeeCode", "TEXT", log)
    create_index(
        cur,
        "IX_Users_EmployeeCode",
        'CREATE UNIQUE INDEX "IX_Users_EmployeeCode" ON "Users" ("EmployeeCode");',
        log,
    )

    # ── 20260813010000_AddUserLocations ─────────────────────────────────────
    create_table(
        cur,
        "UserLocations",
        '''
        CREATE TABLE "UserLocations" (
            "Id" INTEGER NOT NULL CONSTRAINT "PK_UserLocations" PRIMARY KEY AUTOINCREMENT,
            "UserId" INTEGER NOT NULL,
            "LocationId" INTEGER NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            "UpdatedAt" TEXT NULL,
            "IsDeleted" INTEGER NOT NULL DEFAULT 0,
            CONSTRAINT "FK_UserLocations_Users_UserId" FOREIGN KEY ("UserId") REFERENCES "Users" ("Id") ON DELETE CASCADE,
            CONSTRAINT "FK_UserLocations_Locations_LocationId" FOREIGN KEY ("LocationId") REFERENCES "Locations" ("Id") ON DELETE RESTRICT
        );
        ''',
        log,
    )
    create_index(
        cur,
        "IX_UserLocations_UserId_LocationId",
        'CREATE UNIQUE INDEX "IX_UserLocations_UserId_LocationId" ON "UserLocations" ("UserId", "LocationId");',
        log,
    )
    # Backfill -- one row per existing single-location assignment (same as
    # the real migration's backfill), skip if already backfilled.
    cur.execute(
        '''
        INSERT OR IGNORE INTO "UserLocations" ("UserId", "LocationId", "CreatedAt", "IsDeleted")
        SELECT "Id", "LocationId", datetime('now'), 0
        FROM "Users"
        WHERE "LocationId" IS NOT NULL
        '''
    )
    log.append(f"  Backfilled UserLocations from existing Users.LocationId ({cur.rowcount} row(s))")

    # ── 20260813020000_AddTeamIsActive ──────────────────────────────────────
    add_column(cur, "Teams", "IsActive", "INTEGER NOT NULL DEFAULT 1", log)

    con.commit()
    con.close()

    print("\n".join(log))
    print("\nDone. Existing data was not modified or deleted -- only new")
    print("columns/tables were added. Original file backed up at:")
    print(f"  {backup_path}")


if __name__ == "__main__":
    main()
