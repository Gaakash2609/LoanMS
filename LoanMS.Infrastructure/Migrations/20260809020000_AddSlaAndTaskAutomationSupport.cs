using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds: Loans.SlaBreachNotifiedAt (dedupe flag for SLA-breach notifications
    /// — reset to null on every status change) and AppNotifications.TargetUserId
    /// (lets a notification target one specific responsible user, not just a
    /// whole role — needed for SLA-breach/task-follow-up alerts, which go to
    /// the loan's assignee and/or their manager, not a broadcast).
    /// Both additive, nullable. No existing data affected. Safe on an
    /// existing production database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260809020000_AddSlaAndTaskAutomationSupport")]
    public partial class AddSlaAndTaskAutomationSupport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"Loans\" ADD COLUMN IF NOT EXISTS \"SlaBreachNotifiedAt\" timestamp with time zone;");
            migrationBuilder.Sql("ALTER TABLE \"AppNotifications\" ADD COLUMN IF NOT EXISTS \"TargetUserId\" integer;");
            migrationBuilder.Sql("CREATE INDEX IF NOT EXISTS \"IX_AppNotifications_TargetUserId_IsRead_CreatedAt\" ON \"AppNotifications\" (\"TargetUserId\", \"IsRead\", \"CreatedAt\");");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP INDEX IF EXISTS \"IX_AppNotifications_TargetUserId_IsRead_CreatedAt\";");
            migrationBuilder.Sql("ALTER TABLE \"AppNotifications\" DROP COLUMN IF EXISTS \"TargetUserId\";");
            migrationBuilder.Sql("ALTER TABLE \"Loans\" DROP COLUMN IF EXISTS \"SlaBreachNotifiedAt\";");
        }
    }
}
