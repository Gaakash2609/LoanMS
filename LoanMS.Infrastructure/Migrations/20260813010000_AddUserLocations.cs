using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds "UserLocations" — a genuine many-to-many junction table between
    /// Users and Locations (mirrors the existing TeamMembers table's
    /// pattern for Sales/Operation Teams, which was already correctly
    /// many-to-many). Confirmed real gap: User.LocationId was a single FK,
    /// meaning a user (e.g. a Location Head) could only ever be scoped to
    /// one Location — this table is the new source of truth for a user's
    /// FULL set of assigned Locations.
    ///
    /// Backfill: every existing user with a non-null LocationId gets one
    /// UserLocations row for it, so no existing single-location assignment
    /// is lost — User.LocationId itself is left untouched (not removed),
    /// both to avoid a breaking change to any existing single-location
    /// read-path and to serve as this user's "primary" Location going
    /// forward (whichever the first-assigned/most significant one is).
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260813010000_AddUserLocations")]
    public partial class AddUserLocations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS ""UserLocations"" (
                    ""Id"" SERIAL PRIMARY KEY,
                    ""UserId"" integer NOT NULL,
                    ""LocationId"" integer NOT NULL,
                    ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT now(),
                    ""UpdatedAt"" timestamp with time zone,
                    ""IsDeleted"" boolean NOT NULL DEFAULT false,
                    CONSTRAINT ""FK_UserLocations_Users_UserId"" FOREIGN KEY (""UserId"") REFERENCES ""Users""(""Id"") ON DELETE CASCADE,
                    CONSTRAINT ""FK_UserLocations_Locations_LocationId"" FOREIGN KEY (""LocationId"") REFERENCES ""Locations""(""Id"") ON DELETE RESTRICT
                );");
            migrationBuilder.Sql(@"CREATE UNIQUE INDEX IF NOT EXISTS ""IX_UserLocations_UserId_LocationId"" ON ""UserLocations"" (""UserId"", ""LocationId"");");

            // Backfill — one row per existing single-location assignment.
            migrationBuilder.Sql(@"
                INSERT INTO ""UserLocations"" (""UserId"", ""LocationId"", ""CreatedAt"", ""IsDeleted"")
                SELECT ""Id"", ""LocationId"", now(), false
                FROM ""Users""
                WHERE ""LocationId"" IS NOT NULL
                ON CONFLICT DO NOTHING;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"DROP TABLE IF EXISTS ""UserLocations"";");
        }
    }
}
