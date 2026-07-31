using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Phase 5C — Assignment Log: structured, immutable persistence of
    /// "who assigned what to whom".
    ///
    /// Adds the AssignmentLogs table. This is a specialised companion to the
    /// existing generic AuditLogs table (same "no soft-delete, insert-only"
    /// shape), used by TasksController.Create and TicketsController.Create /
    /// Update to record assignment events with the from/to user identities in
    /// dedicated columns instead of buried inside a raw JSON blob. This
    /// migration is additive-only: new table, no changes to any existing
    /// table or column, and no FK constraints to Users (mirrors AuditLog's
    /// plain nullable UserId column) so historical assignment records are
    /// never affected by a user being edited/removed later. Safe to apply on
    /// an existing production database.
    ///
    /// RPT Targets (Phase 5C Part A) required NO migration: the existing
    /// AppSettings table (already in production since an earlier phase) is
    /// reused to store the two target values (rpt_tat_target_days,
    /// rpt_ddr_target_pct) — see ReportsController for the read/write paths.
    /// </summary>
    /// <inheritdoc />
    // PHASE 6 FIX: this migration was missing the [DbContext]/[Migration]
    // attributes that dotnet-ef normally generates (see PHASE6 report for
    // why this matters — without them EF Core cannot register/order this
    // migration for AppDbContext at runtime).
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260730140000_AddAssignmentLog")]
    public partial class AddAssignmentLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AssignmentLogs",
                columns: table => new
                {
                    Id               = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    EntityType       = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EntityId         = table.Column<int>(type: "integer", nullable: false),
                    FromUserId       = table.Column<int>(type: "integer", nullable: true),
                    FromUserName     = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    ToUserId         = table.Column<int>(type: "integer", nullable: false),
                    ToUserName       = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    AssignedByUserId = table.Column<int>(type: "integer", nullable: false),
                    AssignedByName   = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    Notes            = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt        = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssignmentLogs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AssignmentLogs_EntityType_EntityId",
                table: "AssignmentLogs",
                columns: new[] { "EntityType", "EntityId" });

            migrationBuilder.CreateIndex(
                name: "IX_AssignmentLogs_CreatedAt",
                table: "AssignmentLogs",
                column: "CreatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "AssignmentLogs");
        }
    }
}
