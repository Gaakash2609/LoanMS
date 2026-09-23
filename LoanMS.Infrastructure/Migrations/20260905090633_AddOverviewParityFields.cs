using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddOverviewParityFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AnalyticBank",
                table: "Loans",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "BankChecked",
                table: "Loans",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "DocumentChecked",
                table: "Loans",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "EcsReturn",
                table: "Loans",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "FiReportChecked",
                table: "Loans",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "IncomeChecked",
                table: "Loans",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "IncredRmName",
                table: "Loans",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AnalyticBank",
                table: "Loans");

            migrationBuilder.DropColumn(
                name: "BankChecked",
                table: "Loans");

            migrationBuilder.DropColumn(
                name: "DocumentChecked",
                table: "Loans");

            migrationBuilder.DropColumn(
                name: "EcsReturn",
                table: "Loans");

            migrationBuilder.DropColumn(
                name: "FiReportChecked",
                table: "Loans");

            migrationBuilder.DropColumn(
                name: "IncomeChecked",
                table: "Loans");

            migrationBuilder.DropColumn(
                name: "IncredRmName",
                table: "Loans");
        }
    }
}
