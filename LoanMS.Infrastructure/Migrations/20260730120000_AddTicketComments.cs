using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Phase 4B — Tickets: comments / notes / activity persistence.
    ///
    /// Adds a new TicketComments table backing the helpdesk ticket comment panel.
    /// Each row is either a user-authored "Comment" or a system-generated
    /// "Activity" record (written automatically on status/assignment change),
    /// distinguished by the Type column so the UI can render one merged,
    /// chronological timeline per ticket.
    ///
    /// Additive only: new table, no changes to any existing table or column.
    /// Safe to apply on an existing production database.
    /// </summary>
    /// <inheritdoc />
    // PHASE 6 FIX: this migration was missing the [DbContext]/[Migration]
    // attributes that dotnet-ef normally generates (see PHASE6 report for
    // why this matters — without them EF Core cannot register/order this
    // migration for AppDbContext at runtime).
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260730120000_AddTicketComments")]
    public partial class AddTicketComments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TicketComments",
                columns: table => new
                {
                    Id        = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TicketId  = table.Column<int>(type: "integer", nullable: false),
                    UserId    = table.Column<int>(type: "integer", nullable: false),
                    Content   = table.Column<string>(type: "text", nullable: false),
                    Type      = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false, defaultValue: "Comment"),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TicketComments", x => x.Id);
                    table.ForeignKey("FK_TicketComments_Tickets_TicketId", x => x.TicketId, "Tickets", "Id", onDelete: ReferentialAction.Cascade);
                    table.ForeignKey("FK_TicketComments_Users_UserId", x => x.UserId, "Users", "Id", onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TicketComments_TicketId_CreatedAt",
                table: "TicketComments",
                columns: new[] { "TicketId", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "TicketComments");
        }
    }
}
