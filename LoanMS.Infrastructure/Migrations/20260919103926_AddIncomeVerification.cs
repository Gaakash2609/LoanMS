using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddIncomeVerification : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "IncomeVerifications",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanId = table.Column<int>(type: "integer", nullable: false),
                    ApplicantRole = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ApplicantKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    State = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    RequiredMonthsReferenceDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RequiredMonthsJson = table.Column<string>(type: "text", nullable: true),
                    DeclaredIncome = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    ExtractedIncome = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    VerifiedIncome = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    ReasonCodesJson = table.Column<string>(type: "text", nullable: true),
                    PerfiosReportId = table.Column<int>(type: "integer", nullable: true),
                    SourceReportHash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    IdempotencyKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    RunByUserId = table.Column<int>(type: "integer", nullable: false),
                    RunAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ReviewedByUserId = table.Column<int>(type: "integer", nullable: true),
                    ReviewedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReviewDecision = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    ReviewReason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IncomeVerifications", x => x.Id);
                    table.ForeignKey(
                        name: "FK_IncomeVerifications_Loans_LoanId",
                        column: x => x.LoanId,
                        principalTable: "Loans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "SalarySlipExtractions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanId = table.Column<int>(type: "integer", nullable: false),
                    DocumentId = table.Column<int>(type: "integer", nullable: true),
                    ApplicantRole = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ApplicantKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Year = table.Column<int>(type: "integer", nullable: true),
                    Month = table.Column<int>(type: "integer", nullable: true),
                    MonthLabel = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    OriginalNetSalary = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    ExtractionMethod = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    IsTrustedOriginal = table.Column<bool>(type: "boolean", nullable: false),
                    UserEditedSalary = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    OverrideReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    EditedByUserId = table.Column<int>(type: "integer", nullable: true),
                    EditedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ContentHash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SalarySlipExtractions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SalarySlipExtractions_Loans_LoanId",
                        column: x => x.LoanId,
                        principalTable: "Loans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "IncomeVerificationMonths",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    IncomeVerificationId = table.Column<int>(type: "integer", nullable: false),
                    Year = table.Column<int>(type: "integer", nullable: false),
                    Month = table.Column<int>(type: "integer", nullable: false),
                    MonthLabel = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SalarySlipExtractionId = table.Column<int>(type: "integer", nullable: true),
                    OriginalExtractedSalary = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    EffectiveSalary = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    MatchStatus = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    ReasonCode = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    MatchedTransactionRef = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    MatchedTransactionDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    MatchedAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    WindowStart = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    WindowEnd = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    VerificationMethod = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    BankAccountRef = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IncomeVerificationMonths", x => x.Id);
                    table.ForeignKey(
                        name: "FK_IncomeVerificationMonths_IncomeVerifications_IncomeVerifica~",
                        column: x => x.IncomeVerificationId,
                        principalTable: "IncomeVerifications",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_IncomeVerificationMonths_IncomeVerificationId",
                table: "IncomeVerificationMonths",
                column: "IncomeVerificationId");

            migrationBuilder.CreateIndex(
                name: "IX_IncomeVerifications_IdempotencyKey",
                table: "IncomeVerifications",
                column: "IdempotencyKey",
                unique: true,
                filter: "\"IdempotencyKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_IncomeVerifications_LoanId",
                table: "IncomeVerifications",
                column: "LoanId");

            migrationBuilder.CreateIndex(
                name: "IX_IncomeVerifications_LoanId_ApplicantRole_ApplicantKey",
                table: "IncomeVerifications",
                columns: new[] { "LoanId", "ApplicantRole", "ApplicantKey" });

            migrationBuilder.CreateIndex(
                name: "IX_SalarySlipExtractions_ContentHash",
                table: "SalarySlipExtractions",
                column: "ContentHash");

            migrationBuilder.CreateIndex(
                name: "IX_SalarySlipExtractions_LoanId",
                table: "SalarySlipExtractions",
                column: "LoanId");

            migrationBuilder.CreateIndex(
                name: "IX_SalarySlipExtractions_LoanId_ApplicantRole_ApplicantKey_Yea~",
                table: "SalarySlipExtractions",
                columns: new[] { "LoanId", "ApplicantRole", "ApplicantKey", "Year", "Month" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "IncomeVerificationMonths");

            migrationBuilder.DropTable(
                name: "SalarySlipExtractions");

            migrationBuilder.DropTable(
                name: "IncomeVerifications");
        }
    }
}
