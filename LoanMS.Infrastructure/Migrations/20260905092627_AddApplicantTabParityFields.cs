using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddApplicantTabParityFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Address",
                table: "LoanReferences",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AlternatePhone",
                table: "Customers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CompanyType",
                table: "Customers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Designation",
                table: "Customers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HouseNo",
                table: "Customers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MotherName",
                table: "Customers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OfficeAddress",
                table: "Customers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OfficePinCode",
                table: "Customers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OfficialEmail",
                table: "Customers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PermanentAddress",
                table: "Customers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PermanentCity",
                table: "Customers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PermanentHouseNo",
                table: "Customers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PermanentPinCode",
                table: "Customers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PermanentResidenceType",
                table: "Customers",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PermanentState",
                table: "Customers",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Address",
                table: "LoanReferences");

            migrationBuilder.DropColumn(
                name: "AlternatePhone",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "CompanyType",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "Designation",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "HouseNo",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "MotherName",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "OfficeAddress",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "OfficePinCode",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "OfficialEmail",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "PermanentAddress",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "PermanentCity",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "PermanentHouseNo",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "PermanentPinCode",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "PermanentResidenceType",
                table: "Customers");

            migrationBuilder.DropColumn(
                name: "PermanentState",
                table: "Customers");
        }
    }
}
