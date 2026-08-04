using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds the ReportTargets table backing the Reports &amp; Analytics
    /// "Target Editor" panel. Previously this was RPT_TARGETS — a hardcoded
    /// in-memory object in efin-app.js with no backing table at all — this
    /// migration is what makes it real, mirroring AddBankMasterPersistence.
    /// Additive only: new table, no changes to any existing table or column.
    /// Safe to apply on an existing production database; does not touch or
    /// reference any other table, so no existing Loan/Customer/Payout/Report
    /// data or relationships are affected.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260801000000_AddReportTargets")]
    public partial class AddReportTargets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReportTargets",
                columns: table => new
                {
                    Id              = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TargetMonth     = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                    UserId          = table.Column<int>(type: "integer", nullable: true),
                    TeamId          = table.Column<int>(type: "integer", nullable: true),
                    DisbAmt         = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    LoginCount      = table.Column<int>(type: "integer", nullable: false),
                    DisbCount       = table.Column<int>(type: "integer", nullable: false),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt       = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt       = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted       = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReportTargets", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReportTargets_TargetMonth_OrgWide_Unique",
                table: "ReportTargets",
                column: "TargetMonth",
                unique: true,
                filter: "\"IsDeleted\" = false AND \"UserId\" IS NULL AND \"TeamId\" IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "ReportTargets");
        }
    }
}
