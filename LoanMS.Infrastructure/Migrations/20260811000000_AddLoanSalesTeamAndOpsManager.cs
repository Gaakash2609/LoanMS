using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds Loans.SalesTeamName and Loans.OpsManagerId — the Applications
    /// list's "Team & Assignment" panel already had working Sales Team and
    /// Operations Manager dropdowns, but neither field existed anywhere in
    /// the database: a selection appeared to save (it updated the on-screen
    /// row) but silently reverted on refresh or a different device/browser,
    /// since there was nowhere for it to persist. Additive, nullable
    /// columns + a nullable FK (SetNull on delete, matching LoginUserId's
    /// existing convention on this same table). No existing data affected.
    /// Safe on an existing production database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260811000000_AddLoanSalesTeamAndOpsManager")]
    public partial class AddLoanSalesTeamAndOpsManager : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"Loans\" ADD COLUMN IF NOT EXISTS \"SalesTeamName\" character varying(200);");
            migrationBuilder.Sql("ALTER TABLE \"Loans\" ADD COLUMN IF NOT EXISTS \"OpsManagerId\" integer;");
            migrationBuilder.Sql("CREATE INDEX IF NOT EXISTS \"IX_Loans_OpsManagerId\" ON \"Loans\" (\"OpsManagerId\");");
            migrationBuilder.Sql(
                "ALTER TABLE \"Loans\" ADD CONSTRAINT \"FK_Loans_Users_OpsManagerId\" " +
                "FOREIGN KEY (\"OpsManagerId\") REFERENCES \"Users\" (\"Id\") ON DELETE SET NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"Loans\" DROP CONSTRAINT IF EXISTS \"FK_Loans_Users_OpsManagerId\";");
            migrationBuilder.Sql("DROP INDEX IF EXISTS \"IX_Loans_OpsManagerId\";");
            migrationBuilder.Sql("ALTER TABLE \"Loans\" DROP COLUMN IF EXISTS \"OpsManagerId\";");
            migrationBuilder.Sql("ALTER TABLE \"Loans\" DROP COLUMN IF EXISTS \"SalesTeamName\";");
        }
    }
}
