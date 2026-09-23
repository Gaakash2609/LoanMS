using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddLoanDocumentApplicant : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // NOTE: EF auto-emitted a DropIndex("IX_LoanDocuments_LoanId") here because
            // the model snapshot believes that FK index exists — but NO prior migration
            // ever created it (the InitialCreate made only the FK constraint). Dropping
            // it fails on a real database, so it is removed. This migration only ADDS
            // the applicant columns + the composite index (which also covers LoanId).
            migrationBuilder.AddColumn<string>(
                name: "ApplicantKey",
                table: "LoanDocuments",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ApplicantRole",
                table: "LoanDocuments",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                // Gap-2: existing documents belong to the primary applicant.
                defaultValue: "Applicant");

            migrationBuilder.CreateIndex(
                name: "IX_LoanDocuments_LoanId_ApplicantRole_ApplicantKey",
                table: "LoanDocuments",
                columns: new[] { "LoanId", "ApplicantRole", "ApplicantKey" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_LoanDocuments_LoanId_ApplicantRole_ApplicantKey",
                table: "LoanDocuments");

            migrationBuilder.DropColumn(
                name: "ApplicantKey",
                table: "LoanDocuments");

            migrationBuilder.DropColumn(
                name: "ApplicantRole",
                table: "LoanDocuments");
        }
    }
}
