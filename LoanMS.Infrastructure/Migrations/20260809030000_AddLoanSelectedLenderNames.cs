using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds Loans.SelectedLenderNames — a dedicated field for Step 9's
    /// bank-eligibility selection to round-trip cleanly through GetDraft
    /// (resume), instead of parsing it back out of the combined Remarks
    /// text (which already embeds a "Lender: ..." fragment for a different,
    /// audit-trail purpose and was never meant to be machine-parsed back).
    /// Additive, nullable. No existing data affected. Safe on an existing
    /// production database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260809030000_AddLoanSelectedLenderNames")]
    public partial class AddLoanSelectedLenderNames : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"Loans\" ADD COLUMN IF NOT EXISTS \"SelectedLenderNames\" text;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"Loans\" DROP COLUMN IF EXISTS \"SelectedLenderNames\";");
        }
    }
}
