using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds the IncredRmEmails table backing the InCred "RM Emails" screen
    /// (efin-app.js RM_EMAILS). That list previously lived only in frontend
    /// in-memory JS state — never persisted — so it reset on every page
    /// refresh and never appeared on another tab/device. This migration is
    /// what makes it real, database-backed master data. Additive only: new
    /// table, no changes to any existing table or column. Safe to apply on
    /// an existing production database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260730150000_AddIncredRmEmail")]
    public partial class AddIncredRmEmail : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "IncredRmEmails",
                columns: table => new
                {
                    Id        = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name      = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Location  = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Email     = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ContactNo = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IncredRmEmails", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "IncredRmEmails");
        }
    }
}
