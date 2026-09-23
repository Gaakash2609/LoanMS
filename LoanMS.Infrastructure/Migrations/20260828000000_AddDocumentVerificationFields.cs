using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Phase 2 RBAC — G-10 / G-11. Adds document verification + versioning
    /// columns to LoanDocuments so a document can be Verified/Rejected (with a
    /// reason and reviewer trail) and Replaced (versioned, preserving history).
    ///
    /// All additive, all safe on existing data: Status defaults to 'Pending'
    /// and Version to 1 (matching the entity defaults), so every existing
    /// document row is treated exactly as it was before — an unverified,
    /// first-version document. Nothing is dropped, renamed, or rewritten.
    /// Uses ADD COLUMN IF NOT EXISTS, matching the idempotent, re-runnable
    /// convention of the other raw-SQL migrations in this project (e.g.
    /// AddPayoutPaymentDetails).
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260828000000_AddDocumentVerificationFields")]
    public partial class AddDocumentVerificationFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""LoanDocuments"" ADD COLUMN IF NOT EXISTS ""Status"" text NOT NULL DEFAULT 'Pending';
                ALTER TABLE ""LoanDocuments"" ADD COLUMN IF NOT EXISTS ""ReviewNote"" text NULL;
                ALTER TABLE ""LoanDocuments"" ADD COLUMN IF NOT EXISTS ""ReviewedByUserId"" text NULL;
                ALTER TABLE ""LoanDocuments"" ADD COLUMN IF NOT EXISTS ""ReviewedAt"" timestamp with time zone NULL;
                ALTER TABLE ""LoanDocuments"" ADD COLUMN IF NOT EXISTS ""Version"" integer NOT NULL DEFAULT 1;
                ALTER TABLE ""LoanDocuments"" ADD COLUMN IF NOT EXISTS ""SupersededByDocumentId"" integer NULL;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""LoanDocuments"" DROP COLUMN IF EXISTS ""Status"";
                ALTER TABLE ""LoanDocuments"" DROP COLUMN IF EXISTS ""ReviewNote"";
                ALTER TABLE ""LoanDocuments"" DROP COLUMN IF EXISTS ""ReviewedByUserId"";
                ALTER TABLE ""LoanDocuments"" DROP COLUMN IF EXISTS ""ReviewedAt"";
                ALTER TABLE ""LoanDocuments"" DROP COLUMN IF EXISTS ""Version"";
                ALTER TABLE ""LoanDocuments"" DROP COLUMN IF EXISTS ""SupersededByDocumentId"";
            ");
        }
    }
}
