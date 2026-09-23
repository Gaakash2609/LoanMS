using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Per-loan Lender RM override (Lender Email Workflow) — adds the three
    /// nullable RM contact columns on Loans that back the "Update Lender RM"
    /// action (LenderRmName / LenderRmEmail / LenderRmMobile). Mirrors Vanilla's
    /// app.lender_rm_override {name,email,mobile}.
    ///
    /// Written as idempotent raw SQL ("ADD COLUMN IF NOT EXISTS") so it applies
    /// cleanly whether or not the columns are already present — the dev SQLite
    /// database creates them via EnsureCreated, and this only needs to add them
    /// on the shared PostgreSQL database. Only these three columns are touched;
    /// unrelated model/snapshot drift (already covered by earlier migrations) is
    /// deliberately NOT re-applied here.
    /// </summary>
    public partial class AddLenderRmOverride : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"ALTER TABLE ""Loans"" ADD COLUMN IF NOT EXISTS ""LenderRmName"" text;");
            migrationBuilder.Sql(@"ALTER TABLE ""Loans"" ADD COLUMN IF NOT EXISTS ""LenderRmEmail"" text;");
            migrationBuilder.Sql(@"ALTER TABLE ""Loans"" ADD COLUMN IF NOT EXISTS ""LenderRmMobile"" text;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"ALTER TABLE ""Loans"" DROP COLUMN IF EXISTS ""LenderRmName"";");
            migrationBuilder.Sql(@"ALTER TABLE ""Loans"" DROP COLUMN IF EXISTS ""LenderRmEmail"";");
            migrationBuilder.Sql(@"ALTER TABLE ""Loans"" DROP COLUMN IF EXISTS ""LenderRmMobile"";");
        }
    }
}
