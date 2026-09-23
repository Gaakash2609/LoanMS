using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPayoutClaimDetailFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ApacRef",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AsmEmail",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AsmMobile",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AsmName",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankName",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankerEmail",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankerMobile",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BankerName",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BusinessCategory",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "City",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompanyName",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ConfirmationRequired",
                table: "PayoutClaims",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Contests",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DisbursementAmount",
                table: "PayoutClaims",
                type: "numeric",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DisbursementDate",
                table: "PayoutClaims",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DsaMobile",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FirstName",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastName",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LoanNumberRef",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProductName",
                table: "PayoutClaims",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "SplitCase",
                table: "PayoutClaims",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "UserType",
                table: "PayoutClaims",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ApacRef",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "AsmEmail",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "AsmMobile",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "AsmName",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "BankName",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "BankerEmail",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "BankerMobile",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "BankerName",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "BusinessCategory",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "City",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "CompanyName",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "ConfirmationRequired",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "Contests",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "DisbursementAmount",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "DisbursementDate",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "DsaMobile",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "FirstName",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "LastName",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "LoanNumberRef",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "ProductName",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "SplitCase",
                table: "PayoutClaims");

            migrationBuilder.DropColumn(
                name: "UserType",
                table: "PayoutClaims");
        }
    }
}
