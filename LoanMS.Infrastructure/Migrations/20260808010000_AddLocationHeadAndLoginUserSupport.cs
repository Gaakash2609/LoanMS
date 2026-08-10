using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds the two columns needed for the corrected Location Head / Login
    /// Team / Operation Manager visibility rules from the final Role &amp;
    /// Access spec:
    ///
    ///   Users.LocationId  — a real FK, distinct from the existing free-text
    ///     Users.LocationName. Lets a Location Head's loan visibility be
    ///     scoped directly by Location, independent of any team membership
    ///     (their access is meant to cut across every team at their
    ///     Location, not just one team).
    ///
    ///   Loans.LoginUserId — distinct from Loans.AssignedToUserId (which is
    ///     dedicated to the Sales Person per the Wizard Sales Person
    ///     Assignment work). Lets an individual Login Team member see only
    ///     their own personally-assigned processing queue, and an Operation
    ///     Manager supervise their whole team's queue, instead of the
    ///     Location-based proxy rule used before this column existed.
    ///
    /// NOTE — Users.LocationId (and the Users -&gt; Location relationship) was
    /// already fully described in AppDbContextModelSnapshot.cs and in
    /// Location.cs's `Users` collection navigation before this migration —
    /// evidently started in an earlier session and never finished: the
    /// User.cs entity property, the AppDbContext.OnModelCreating wiring, and
    /// this migration were all missing, so the column never actually existed
    /// on any real database despite the snapshot expecting it. This
    /// migration is what actually creates it.
    ///
    /// Additive only: two new nullable columns + their indexes/FKs. Does not
    /// touch any existing column or table. Safe to apply on an existing
    /// production database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260808010000_AddLocationHeadAndLoginUserSupport")]
    public partial class AddLocationHeadAndLoginUserSupport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── Users: real Location FK (Location Head visibility) ──────────────────
            migrationBuilder.Sql(
                "ALTER TABLE \"Users\" ADD COLUMN IF NOT EXISTS \"LocationId\" integer;");

            // ── Loans: Login User (Login Team / Operation Manager visibility) ───────
            migrationBuilder.Sql(
                "ALTER TABLE \"Loans\" ADD COLUMN IF NOT EXISTS \"LoginUserId\" integer;");

            // ── Indexes ───────────────────────────────────────────────────────────
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS \"IX_Users_LocationId\" ON \"Users\" (\"LocationId\");");
            migrationBuilder.Sql(
                "CREATE INDEX IF NOT EXISTS \"IX_Loans_LoginUserId\" ON \"Loans\" (\"LoginUserId\");");

            // ── Foreign Keys (both nullable / SetNull — never blocks deletes) ───────
            // Guarded with a DO block since ADD CONSTRAINT has no native
            // IF NOT EXISTS in PostgreSQL — mirrors the idempotent-column
            // pattern used elsewhere in this migration for the same
            // "safe to re-run" guarantee.
            migrationBuilder.Sql(@"
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'FK_Users_Locations_LocationId'
                    ) THEN
                        ALTER TABLE ""Users""
                        ADD CONSTRAINT ""FK_Users_Locations_LocationId""
                        FOREIGN KEY (""LocationId"") REFERENCES ""Locations"" (""Id"") ON DELETE SET NULL;
                    END IF;
                END $$;");

            migrationBuilder.Sql(@"
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'FK_Loans_Users_LoginUserId'
                    ) THEN
                        ALTER TABLE ""Loans""
                        ADD CONSTRAINT ""FK_Loans_Users_LoginUserId""
                        FOREIGN KEY (""LoginUserId"") REFERENCES ""Users"" (""Id"") ON DELETE SET NULL;
                    END IF;
                END $$;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"Loans\" DROP CONSTRAINT IF EXISTS \"FK_Loans_Users_LoginUserId\";");
            migrationBuilder.Sql("ALTER TABLE \"Users\" DROP CONSTRAINT IF EXISTS \"FK_Users_Locations_LocationId\";");

            migrationBuilder.Sql("DROP INDEX IF EXISTS \"IX_Loans_LoginUserId\";");
            migrationBuilder.Sql("DROP INDEX IF EXISTS \"IX_Users_LocationId\";");

            migrationBuilder.Sql("ALTER TABLE \"Loans\" DROP COLUMN IF EXISTS \"LoginUserId\";");
            migrationBuilder.Sql("ALTER TABLE \"Users\" DROP COLUMN IF EXISTS \"LocationId\";");
        }
    }
}
