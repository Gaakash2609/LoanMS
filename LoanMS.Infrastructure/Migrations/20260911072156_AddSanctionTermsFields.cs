using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSanctionTermsFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "SanctionEmi",
                table: "LoanSanctionDetails",
                type: "numeric(18,2)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "SanctionLoanAmt",
                table: "LoanSanctionDetails",
                type: "numeric(18,2)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "SanctionRoi",
                table: "LoanSanctionDetails",
                type: "numeric(5,2)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SanctionTenureMonths",
                table: "LoanSanctionDetails",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SanctionEmi",
                table: "LoanSanctionDetails");

            migrationBuilder.DropColumn(
                name: "SanctionLoanAmt",
                table: "LoanSanctionDetails");

            migrationBuilder.DropColumn(
                name: "SanctionRoi",
                table: "LoanSanctionDetails");

            migrationBuilder.DropColumn(
                name: "SanctionTenureMonths",
                table: "LoanSanctionDetails");
        }
    }
}
