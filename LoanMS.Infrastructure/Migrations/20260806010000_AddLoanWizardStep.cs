using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds Loans.WizardStep (nullable int). Previously which step of the New
    /// Application wizard an in-progress Draft loan was on lived only in the
    /// browser's localStorage (wizard_draft_meta:* keys, frontend/src/utils/
    /// draftStorage.ts) — invisible to any other device/browser and to
    /// WizardController's own draft endpoints. Additive only — one new
    /// nullable column, no changes to any existing column.
    ///
    /// IMPORTANT — written as idempotent raw SQL (ADD COLUMN IF NOT EXISTS),
    /// matching 20260806000000_AddUserProfileFields, so Up() stays safe to
    /// run even if this column was ever added out-of-band directly on the
    /// database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260806010000_AddLoanWizardStep")]
    public partial class AddLoanWizardStep : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE \"Loans\" ADD COLUMN IF NOT EXISTS \"WizardStep\" integer;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"Loans\" DROP COLUMN IF EXISTS \"WizardStep\";");
        }
    }
}
