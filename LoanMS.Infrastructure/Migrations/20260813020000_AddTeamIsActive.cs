using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds Teams.IsActive — confirmed real gap: Team Archive/Active status
    /// was session/local-only (a plain in-memory JS field, twArchiveTeam()
    /// never persisted anywhere), so an archived team reverted to "Active"
    /// on every refresh, logout/login, or new device. New, NOT NULL column
    /// with DEFAULT true — every existing Team safely becomes Active (there
    /// was never any reliable prior archive-signal anywhere to preserve;
    /// the only persistent state Team ever had was soft-delete/IsDeleted,
    /// which is untouched by this migration). No existing data is deleted
    /// or altered beyond adding this one column.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260813020000_AddTeamIsActive")]
    public partial class AddTeamIsActive : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"ALTER TABLE ""Teams"" ADD COLUMN IF NOT EXISTS ""IsActive"" boolean NOT NULL DEFAULT true;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"ALTER TABLE ""Teams"" DROP COLUMN IF EXISTS ""IsActive"";");
        }
    }
}
