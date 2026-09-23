using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds the four payment-detail columns to PayoutClaims —
    /// PaymentMode, PaymentReference (UTR), PaymentDate, BankAccountLast4.
    ///
    /// Confirmed real gap: the legacy Claim Status/Payment modal captures
    /// all four when a claim is marked Paid, but PayoutClaim carried only
    /// Status/Notes/PaidAt, so those values had nowhere to live — they were
    /// being folded into the free-text Notes column, which meant they could
    /// be displayed but never filtered, grouped or reported on (e.g. "how
    /// much went out by RTGS this month").
    ///
    /// All four are NULLABLE with no default: a claim legitimately has no
    /// payment details until it is actually paid, and every existing row
    /// keeps its current data untouched. Nothing is dropped, renamed or
    /// rewritten — this migration only adds columns. Any payment info
    /// previously written into Notes stays exactly where it is (this
    /// migration deliberately does NOT attempt to parse and backfill it,
    /// since that text was free-form and a bad parse would corrupt real
    /// records; historical claims simply keep it in Notes).
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260818000000_AddPayoutPaymentDetails")]
    public partial class AddPayoutPaymentDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""PayoutClaims"" ADD COLUMN IF NOT EXISTS ""PaymentMode"" text NULL;
                ALTER TABLE ""PayoutClaims"" ADD COLUMN IF NOT EXISTS ""PaymentReference"" text NULL;
                ALTER TABLE ""PayoutClaims"" ADD COLUMN IF NOT EXISTS ""PaymentDate"" timestamp with time zone NULL;
                ALTER TABLE ""PayoutClaims"" ADD COLUMN IF NOT EXISTS ""BankAccountLast4"" text NULL;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""PayoutClaims"" DROP COLUMN IF EXISTS ""PaymentMode"";
                ALTER TABLE ""PayoutClaims"" DROP COLUMN IF EXISTS ""PaymentReference"";
                ALTER TABLE ""PayoutClaims"" DROP COLUMN IF EXISTS ""PaymentDate"";
                ALTER TABLE ""PayoutClaims"" DROP COLUMN IF EXISTS ""BankAccountLast4"";
            ");
        }
    }
}
