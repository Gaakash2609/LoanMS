using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds the LoanObligations table — the "Running Loan Obligations" (FOIR
    /// tab) data per loan application. Previously frontend-only
    /// (efin-app.js `var OBLIGATIONS = {}`), persisted only to the browser's
    /// localStorage, so obligation rows added on one browser/device never
    /// appeared on another. Additive only: new table, FK to Loans (cascade
    /// delete — obligations disappear with their parent loan), no changes to
    /// any existing table or column. Safe to apply on an existing production
    /// database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260731000000_AddLoanObligations")]
    public partial class AddLoanObligations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "LoanObligations",
                columns: table => new
                {
                    Id                = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanApplicationId = table.Column<int>(type: "integer", nullable: false),
                    LoanType          = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    SanctionAmount    = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    FinancerName      = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    LoanEmi           = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    AmountOutstanding = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    LoanClosureDate   = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LoanAccountNumber = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    SelectBT          = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted         = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LoanObligations", x => x.Id);
                    table.ForeignKey("FK_LoanObligations_Loans_LoanApplicationId", x => x.LoanApplicationId, "Loans", "Id", onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LoanObligations_LoanApplicationId",
                table: "LoanObligations",
                column: "LoanApplicationId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "LoanObligations");
        }
    }
}
