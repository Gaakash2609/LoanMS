using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class ExtendLoanObligationsForCreditReview : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ApplicantKey",
                table: "LoanObligations",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ApplicantRole",
                table: "LoanObligations",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Applicant");

            migrationBuilder.AddColumn<int>(
                name: "CreatedByUserId",
                table: "LoanObligations",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DetectedAccountNumber",
                table: "LoanObligations",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DetectedEmi",
                table: "LoanObligations",
                type: "numeric(18,2)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DetectedFinancerName",
                table: "LoanObligations",
                type: "character varying(150)",
                maxLength: 150,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DetectionEvidenceJson",
                table: "LoanObligations",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DetectionSignature",
                table: "LoanObligations",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "InterestRate",
                table: "LoanObligations",
                type: "numeric(9,4)",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsClosed",
                table: "LoanObligations",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IsManualOverride",
                table: "LoanObligations",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "MaturityDate",
                table: "LoanObligations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Notes",
                table: "LoanObligations",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "OverriddenAt",
                table: "LoanObligations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "OverriddenByUserId",
                table: "LoanObligations",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OverrideReason",
                table: "LoanObligations",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "LoanObligations",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Manual");

            migrationBuilder.AddColumn<int>(
                name: "SourcePerfiosReportId",
                table: "LoanObligations",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "StartDate",
                table: "LoanObligations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TenureMonths",
                table: "LoanObligations",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VerificationNote",
                table: "LoanObligations",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "VerificationStatus",
                table: "LoanObligations",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Unverified");

            migrationBuilder.AddColumn<DateTime>(
                name: "VerifiedAt",
                table: "LoanObligations",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "VerifiedByUserId",
                table: "LoanObligations",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_LoanObligations_LoanApplicationId_ApplicantRole_ApplicantKey",
                table: "LoanObligations",
                columns: new[] { "LoanApplicationId", "ApplicantRole", "ApplicantKey" });

            migrationBuilder.CreateIndex(
                name: "IX_LoanObligations_LoanApplicationId_DetectionSignature",
                table: "LoanObligations",
                columns: new[] { "LoanApplicationId", "DetectionSignature" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_LoanObligations_LoanApplicationId_ApplicantRole_ApplicantKey",
                table: "LoanObligations");

            migrationBuilder.DropIndex(
                name: "IX_LoanObligations_LoanApplicationId_DetectionSignature",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "ApplicantKey",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "ApplicantRole",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "CreatedByUserId",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "DetectedAccountNumber",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "DetectedEmi",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "DetectedFinancerName",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "DetectionEvidenceJson",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "DetectionSignature",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "InterestRate",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "IsClosed",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "IsManualOverride",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "MaturityDate",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "Notes",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "OverriddenAt",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "OverriddenByUserId",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "OverrideReason",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "SourcePerfiosReportId",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "StartDate",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "TenureMonths",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "VerificationNote",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "VerificationStatus",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "VerifiedAt",
                table: "LoanObligations");

            migrationBuilder.DropColumn(
                name: "VerifiedByUserId",
                table: "LoanObligations");
        }
    }
}
