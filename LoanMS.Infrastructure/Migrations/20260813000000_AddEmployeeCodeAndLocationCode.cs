using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds Locations.Code (short code used to build Employee Codes, e.g.
    /// "HO", "AND") and Users.EmployeeCode (the permanent MH-{ROLE}-
    /// {LOCATION}-{RANDOM4} identifier — see IEmployeeCodeGenerator).
    ///
    /// Both new, nullable columns — no existing data affected. Existing
    /// Locations get a NOT NULL DEFAULT ''-equivalent auto-derived Code
    /// (first 3 letters of Name, uppercase) so EmployeeCodeGenerator has
    /// something usable immediately; existing Users are backfilled
    /// separately at application startup (see Program.cs) using the same
    /// generator service the rest of the app uses, rather than duplicating
    /// its random+uniqueness-retry logic here in raw SQL.
    ///
    /// The partial unique index on EmployeeCode allows multiple NULL rows
    /// (PostgreSQL's default UNIQUE-index behavior — NULLs are not
    /// considered equal to each other) so this migration is safe to apply
    /// before the startup backfill has run, and remains the final,
    /// authoritative protection against a race between two concurrent
    /// user-creation requests.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260813000000_AddEmployeeCodeAndLocationCode")]
    public partial class AddEmployeeCodeAndLocationCode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"ALTER TABLE ""Locations"" ADD COLUMN IF NOT EXISTS ""Code"" character varying(20);");
            migrationBuilder.Sql(@"UPDATE ""Locations"" SET ""Code"" = UPPER(LEFT(REGEXP_REPLACE(""Name"", '[^A-Za-z]', '', 'g'), 3)) WHERE ""Code"" IS NULL OR ""Code"" = '';");
            migrationBuilder.Sql(@"ALTER TABLE ""Locations"" ALTER COLUMN ""Code"" SET DEFAULT '';");
            migrationBuilder.Sql(@"ALTER TABLE ""Locations"" ALTER COLUMN ""Code"" SET NOT NULL;");

            migrationBuilder.Sql(@"ALTER TABLE ""Users"" ADD COLUMN IF NOT EXISTS ""EmployeeCode"" character varying(40);");
            migrationBuilder.Sql(@"CREATE UNIQUE INDEX IF NOT EXISTS ""IX_Users_EmployeeCode"" ON ""Users"" (""EmployeeCode"");");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"DROP INDEX IF EXISTS ""IX_Users_EmployeeCode"";");
            migrationBuilder.Sql(@"ALTER TABLE ""Users"" DROP COLUMN IF EXISTS ""EmployeeCode"";");
            migrationBuilder.Sql(@"ALTER TABLE ""Locations"" DROP COLUMN IF EXISTS ""Code"";");
        }
    }
}
