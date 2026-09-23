using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Phase 2 RBAC — G-23. Adds a structured "Reason" column to AuditLogs so a
    /// sensitive action's justification (Admin stage override, and any write
    /// whose body carries a top-level reason/comment) is a first-class,
    /// queryable field rather than being buried inside the NewValues JSON blob.
    ///
    /// Additive and nullable — existing audit rows are untouched. Idempotent
    /// ADD COLUMN IF NOT EXISTS, matching the other raw-SQL migrations here.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260828010000_AddAuditLogReason")]
    public partial class AddAuditLogReason : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""AuditLogs"" ADD COLUMN IF NOT EXISTS ""Reason"" text NULL;
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                ALTER TABLE ""AuditLogs"" DROP COLUMN IF EXISTS ""Reason"";
            ");
        }
    }
}
