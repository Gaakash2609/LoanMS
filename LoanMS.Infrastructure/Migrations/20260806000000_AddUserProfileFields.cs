using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds PhoneNumber, LocationName, SalesTeam, OpTeam to Users. The
    /// Add/Edit User form already captures these (tw-um-mobile/loc/st/ot in
    /// efin-app.js), but the backend User entity had nowhere to store them,
    /// so they were silently dropped on save even after wiring the Add User
    /// button to a real API call. Additive only — 4 new nullable columns, no
    /// changes to any existing column.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260806000000_AddUserProfileFields")]
    public partial class AddUserProfileFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PhoneNumber",
                table: "Users",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LocationName",
                table: "Users",
                type: "character varying(150)",
                maxLength: 150,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SalesTeam",
                table: "Users",
                type: "character varying(150)",
                maxLength: 150,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OpTeam",
                table: "Users",
                type: "character varying(150)",
                maxLength: 150,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "PhoneNumber", table: "Users");
            migrationBuilder.DropColumn(name: "LocationName", table: "Users");
            migrationBuilder.DropColumn(name: "SalesTeam", table: "Users");
            migrationBuilder.DropColumn(name: "OpTeam", table: "Users");
        }
    }
}
