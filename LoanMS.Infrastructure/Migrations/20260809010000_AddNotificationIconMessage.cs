using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds Icon/Message to AppNotifications so the topbar notification bell
    /// (previously a browser-session-only, in-memory NOTIF_STORE array in
    /// efin-app.js — never read from or written to the server at all) can be
    /// backed entirely by GET/POST /api/notifications + PUT .../read, reusing
    /// this same table instead of a second notification system. Existing
    /// (Type/ClaimId/Partner/Amount) fields are unchanged — Icon/Message are
    /// purely additive and nullable, so existing rows are unaffected.
    /// Safe to apply on an existing production database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260809010000_AddNotificationIconMessage")]
    public partial class AddNotificationIconMessage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"AppNotifications\" ADD COLUMN IF NOT EXISTS \"Icon\" character varying(10);");
            migrationBuilder.Sql("ALTER TABLE \"AppNotifications\" ADD COLUMN IF NOT EXISTS \"Message\" character varying(500);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"AppNotifications\" DROP COLUMN IF EXISTS \"Message\";");
            migrationBuilder.Sql("ALTER TABLE \"AppNotifications\" DROP COLUMN IF EXISTS \"Icon\";");
        }
    }
}
