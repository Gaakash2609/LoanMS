using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds the RejectionReasons table backing the Policy &amp; Product page's
    /// "Rejection Reasons" list. Previously this was frontend-only
    /// (rejection-reasons.js, localStorage key '_pp_rejection_reasons') — one
    /// admin's edits never appeared for anyone else. Additive only: new
    /// table, no changes to any existing table or column. Safe to apply on an
    /// existing production database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260805000000_AddRejectionReasons")]
    public partial class AddRejectionReasons : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RejectionReasons",
                columns: table => new
                {
                    Id              = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Key             = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    Label           = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    SortOrder       = table.Column<int>(type: "integer", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt       = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt       = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted       = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RejectionReasons", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RejectionReasons_Key",
                table: "RejectionReasons",
                column: "Key",
                unique: true,
                filter: "\"IsDeleted\" = false");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "RejectionReasons");
        }
    }
}
