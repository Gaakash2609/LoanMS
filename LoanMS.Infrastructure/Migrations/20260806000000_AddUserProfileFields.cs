using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds PhoneNumber, LocationName, SalesTeam, OpTeam to Users. The
    /// Add/Edit User form already captures these (tw-um-mobile/loc/st/ot in
    /// efin-app.js), but the backend User entity had nowhere to store them,
    /// so they were silently dropped on save even after wiring the Add User
    /// button to a real API call. Additive only — 4 new nullable columns, no
    /// changes to any existing column.
    ///
    /// IMPORTANT — written as idempotent raw SQL (ADD COLUMN IF NOT EXISTS),
    /// not migrationBuilder.AddColumn(). Program.cs re-throws on any
    /// migration failure to fail startup fast, and the plain AddColumn
    /// form throws "column already exists" if one of these 4 columns was
    /// ever added by hand directly on the production DB (the same class of
    /// out-of-band change described in docs/troubleshooting/DATABASE_SCHEMA_FIX.md for the
    /// Customers table). That exception was crash-looping every new ECS
    /// task on this deploy — the container never got PostgreSQL migrations
    /// applied, so the previous task (which never had this migration)
    /// stayed the only Running/Healthy one and the deployment timed out
    /// waiting for the new task to stabilize. IF NOT EXISTS makes Up()
    /// safe to run against a DB that already has some or all of these
    /// columns, whatever the reason.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260806000000_AddUserProfileFields")]
    public partial class AddUserProfileFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE \"Users\" ADD COLUMN IF NOT EXISTS \"PhoneNumber\" character varying(30);");

            migrationBuilder.Sql(
                "ALTER TABLE \"Users\" ADD COLUMN IF NOT EXISTS \"LocationName\" character varying(150);");

            migrationBuilder.Sql(
                "ALTER TABLE \"Users\" ADD COLUMN IF NOT EXISTS \"SalesTeam\" character varying(150);");

            migrationBuilder.Sql(
                "ALTER TABLE \"Users\" ADD COLUMN IF NOT EXISTS \"OpTeam\" character varying(150);");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"Users\" DROP COLUMN IF EXISTS \"PhoneNumber\";");
            migrationBuilder.Sql("ALTER TABLE \"Users\" DROP COLUMN IF EXISTS \"LocationName\";");
            migrationBuilder.Sql("ALTER TABLE \"Users\" DROP COLUMN IF EXISTS \"SalesTeam\";");
            migrationBuilder.Sql("ALTER TABLE \"Users\" DROP COLUMN IF EXISTS \"OpTeam\";");
        }
    }
}
