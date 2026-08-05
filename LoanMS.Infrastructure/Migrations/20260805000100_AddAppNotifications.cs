using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds the AppNotifications table backing in-app Management alerts (e.g.
    /// "payout claim submitted"). Previously this was frontend-only
    /// (notifyManagement() in efin-app.js, localStorage key
    /// 'mgmt_notifications') — the notification was written to whichever
    /// browser triggered the event, so the intended recipient (Admin/
    /// Accounts, often a different device) never actually saw it. Additive
    /// only: new table, no changes to any existing table or column.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260805000100_AddAppNotifications")]
    public partial class AddAppNotifications : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AppNotifications",
                columns: table => new
                {
                    Id         = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Type       = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    ClaimId    = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    Partner    = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Amount     = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                    TargetRole = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    IsRead     = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    CreatedAt  = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt  = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted  = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AppNotifications", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AppNotifications_TargetRole_IsRead_CreatedAt",
                table: "AppNotifications",
                columns: new[] { "TargetRole", "IsRead", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "AppNotifications");
        }
    }
}
