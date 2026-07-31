using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Phase 3 — Payout Claims: multi-claimant support + idempotency.
    ///
    /// Adds a ClaimType column ("Sales" | "Dsa" | "Partner" | "Login" | "Manager" |
    /// "Admin") so the same loan can carry one PayoutClaim per eligible claimant
    /// instead of a single claim per loan. Backfills existing rows to "Sales"
    /// (their prior implicit meaning) so no historical data is lost or reinterpreted
    /// incorrectly for the majority case.
    ///
    /// Adds a unique filtered index on (LoanId, ClaimedByUserId, ClaimType) —
    /// scoped to non-deleted rows — as a database-level duplicate-claim guard to
    /// back up the application-level idempotency check.
    ///
    /// Additive only: new nullable-with-default column + a new index. Does not
    /// drop or rewrite any existing table or column. Safe to apply on an existing
    /// production database.
    /// </summary>
    /// <inheritdoc />
    // PHASE 6 FIX: this migration was missing the [DbContext]/[Migration]
    // attributes that dotnet-ef normally generates (see PHASE6 report for
    // why this matters — without them EF Core cannot register/order this
    // migration for AppDbContext at runtime).
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260730060000_AddPayoutClaimTypeAndIdempotency")]
    public partial class AddPayoutClaimTypeAndIdempotency : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ClaimType",
                table: "PayoutClaims",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Sales");

            // Belt-and-braces backfill: AddColumn's defaultValue already applies to
            // existing rows in Postgres, but this makes the intent explicit and is
            // a no-op if it already ran.
            migrationBuilder.Sql(
                "UPDATE \"PayoutClaims\" SET \"ClaimType\" = 'Sales' WHERE \"ClaimType\" IS NULL;");

            migrationBuilder.CreateIndex(
                name: "IX_PayoutClaims_Loan_Claimant_Type_Unique",
                table: "PayoutClaims",
                columns: new[] { "LoanId", "ClaimedByUserId", "ClaimType" },
                unique: true,
                filter: "\"IsDeleted\" = false");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_PayoutClaims_Loan_Claimant_Type_Unique",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "ClaimType",
                table: "PayoutClaims");
        }
    }
}
