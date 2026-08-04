using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds a nullable UserId column to AppSettings so the existing generic
    /// Key/Value settings table can also hold PER-USER data — starting with
    /// the User Profile page (Primary/Address/Bank details), which was
    /// previously frontend-only (USER_PROFILES object in efin-app.js,
    /// persisted solely to localStorage under 'efin_user_profiles').
    ///
    /// Before this migration, AppSettings had exactly one unique index —
    /// on Key alone — which only supports organization-wide settings (one
    /// row per Key, e.g. Roles/Menu-Visibility/InCred/AI/Email/branding
    /// config). There was no per-user scoping at all.
    ///
    /// This migration:
    ///   1. Adds AppSettings.UserId (int, nullable). NULL = org-wide row
    ///      (unchanged meaning for every existing row/feature).
    ///   2. Drops the old single-column unique index on Key.
    ///   3. Re-creates it as a FILTERED unique index that only applies
    ///      WHERE "UserId" IS NULL — so org-wide settings keep the exact
    ///      same one-row-per-Key guarantee as before (zero behaviour change
    ///      for Admin Master Control, Menu Visibility, InCred/AI/Email
    ///      credentials, sign-in logo, webhook logs, etc).
    ///   4. Adds a second filtered unique index on (Key, UserId) WHERE
    ///      "UserId" IS NOT NULL — so each user gets their own independent
    ///      row per Key (e.g. every user has their own "efin_user_profile"
    ///      row, keyed by their own UserId).
    ///
    /// Additive/backward-compatible: every existing row has UserId = NULL
    /// after this migration and keeps behaving exactly as before.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260804010000_AddUserIdToAppSettings")]
    public partial class AddUserIdToAppSettings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "UserId",
                table: "AppSettings",
                type: "integer",
                nullable: true);

            migrationBuilder.DropIndex(
                name: "IX_AppSettings_Key",
                table: "AppSettings");

            migrationBuilder.CreateIndex(
                name: "IX_AppSettings_Key_OrgWide_Unique",
                table: "AppSettings",
                column: "Key",
                unique: true,
                filter: "\"UserId\" IS NULL");

            migrationBuilder.CreateIndex(
                name: "IX_AppSettings_Key_UserId_Unique",
                table: "AppSettings",
                columns: new[] { "Key", "UserId" },
                unique: true,
                filter: "\"UserId\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_AppSettings_Key_UserId_Unique",
                table: "AppSettings");

            migrationBuilder.DropIndex(
                name: "IX_AppSettings_Key_OrgWide_Unique",
                table: "AppSettings");

            // Rows with UserId set would violate the old single-column unique
            // index on Key if there happen to be duplicates by that point;
            // this mirrors a standard EF rollback and assumes Down is run
            // before per-user rows have accumulated (i.e. right after Up).
            migrationBuilder.DropColumn(
                name: "UserId",
                table: "AppSettings");

            migrationBuilder.CreateIndex(
                name: "IX_AppSettings_Key",
                table: "AppSettings",
                column: "Key",
                unique: true);
        }
    }
}
