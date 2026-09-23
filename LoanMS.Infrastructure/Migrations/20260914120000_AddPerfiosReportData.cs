using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds PerfiosReports."ReportDataJson" — the COMPLETE bank-statement
    /// analysis payload (every parsed transaction, category buckets, ABB month
    /// grid, validation checks, account header) serialized as JSON. Until now
    /// only the ~10 summary columns were persisted, so Reports &gt; Perfios
    /// Report could not re-hydrate the full report after a refresh / on another
    /// device — the full report lived only in frontend memory for the run that
    /// produced it. Additive, nullable column; existing rows keep rendering
    /// from their summary columns. Idempotent (ADD COLUMN IF NOT EXISTS) and
    /// safe on an existing production database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260914120000_AddPerfiosReportData")]
    public partial class AddPerfiosReportData : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE \"PerfiosReports\" ADD COLUMN IF NOT EXISTS \"ReportDataJson\" text;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                "ALTER TABLE \"PerfiosReports\" DROP COLUMN IF EXISTS \"ReportDataJson\";");
        }
    }
}
