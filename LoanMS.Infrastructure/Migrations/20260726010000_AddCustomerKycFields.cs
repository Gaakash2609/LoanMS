using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <inheritdoc />
    // PHASE 6 FIX: this migration was missing the [DbContext]/[Migration]
    // attributes that dotnet-ef normally generates (see PHASE6 report for
    // why this matters — without them EF Core cannot register/order this
    // migration for AppDbContext at runtime).
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260726010000_AddCustomerKycFields")]
    public partial class AddCustomerKycFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Gender",
                table: "Customers",
                type: "character varying(1)",
                maxLength: 1,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "FatherName",
                table: "Customers",
                type: "character varying(150)",
                maxLength: 150,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ResidenceType",
                table: "Customers",
                type: "character varying(40)",
                maxLength: 40,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "Gender", table: "Customers");
            migrationBuilder.DropColumn(name: "FatherName", table: "Customers");
            migrationBuilder.DropColumn(name: "ResidenceType", table: "Customers");
        }
    }
}
