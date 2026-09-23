using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Snapshot-only migration. Deliberately applies NO schema changes.
    ///
    /// WHY THIS EXISTS
    /// ---------------
    /// Every migration in this project is hand-authored raw SQL
    /// (migrationBuilder.Sql) and none of them carried a .Designer.cs snapshot, so
    /// AppDbContextModelSnapshot.cs stopped tracking the model somewhere around
    /// 20260811. About ten later migrations added real schema the snapshot never
    /// recorded. EF Core 9+ turns PendingModelChangesWarning into a thrown error,
    /// so `dotnet ef database update` and the project's efbundle migration runner
    /// (deploy/docker/Dockerfile.migration — the documented AWS path) both failed
    /// with "The model for context 'AppDbContext' has pending changes", even
    /// though the database was completely up to date.
    ///
    /// Regenerating this migration produced a diff of 21 AddColumn, 3 CreateTable,
    /// 15 AlterColumn, 5 CreateIndex, 3 AddForeignKey and 1 DropForeignKey. Each
    /// AddColumn and CreateTable target was checked against a PostgreSQL database
    /// built from the full migration chain: all 21 columns and all 3 tables
    /// ALREADY EXIST. Running the scaffolded Up() would therefore not add anything
    /// — it would fail with "column already exists" on the first statement.
    ///
    /// The Designer file beside this migration carries the regenerated, accurate
    /// snapshot. That is the entire point of this migration: it re-anchors EF's
    /// model baseline without touching the database.
    ///
    /// WHY Up() IS EMPTY RATHER THAN PARTIAL
    /// ------------------------------------
    /// The only operations in the scaffolded Up() that are not already satisfied
    /// by the database are 15 AlterColumn (character varying(n) -> text) and one
    /// DropForeignKey (FK_Users_Locations_LocationId). Neither is required for the
    /// application to work — that is the schema production has been running on —
    /// and both change existing objects rather than adding new ones. Executing
    /// them is a separate, deliberate decision for the database owner, not a
    /// side effect of fixing the tooling. Leaving Up() empty keeps this migration
    /// provably non-destructive: it runs zero DDL.
    ///
    /// A fresh database is unaffected: the 21 columns and 3 tables are created by
    /// the existing raw-SQL migrations earlier in the chain (verified by applying
    /// all migrations to an empty PostgreSQL and inspecting the result), so this
    /// migration being a no-op does not leave a new deployment short of schema.
    ///
    /// DO NOT "fill in" Up() from a regenerated scaffold. Doing so would emit
    /// AddColumn/CreateTable statements for objects that already exist and break
    /// the migration run.
    /// </summary>
    /// <inheritdoc />
    public partial class ResyncModelSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Intentionally empty — see the class summary above.
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Intentionally empty — this migration changes no schema, so there is
            // nothing to revert.
        }
    }
}
