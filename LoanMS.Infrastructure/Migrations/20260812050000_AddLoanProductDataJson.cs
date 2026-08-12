using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds ProductDataJson to Loans — 28 product-specific wizard fields
    /// (Insurance nominee/insurer/premium, Property builder/city/value,
    /// Vehicle make/model/dealer, Education institution/course/duration)
    /// confirmed NEVER reaching WizardSubmitDto at all — the biggest gap
    /// found in this pass, since it means this data was lost the moment
    /// the wizard page was closed, not even on refresh. New, nullable
    /// column only. No existing data affected. Safe on an existing
    /// production database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260812050000_AddLoanProductDataJson")]
    public partial class AddLoanProductDataJson : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"ALTER TABLE ""Loans"" ADD COLUMN IF NOT EXISTS ""ProductDataJson"" text;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"ALTER TABLE ""Loans"" DROP COLUMN IF EXISTS ""ProductDataJson"";");
        }
    }
}
