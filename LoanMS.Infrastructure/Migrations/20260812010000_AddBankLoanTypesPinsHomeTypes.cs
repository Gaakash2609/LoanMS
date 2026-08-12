using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds LoanTypesJson / ServiceablePinsJson / HomeTypesJson to Banks —
    /// three more "Lender Configuration" fields confirmed local-only (Product-
    /// Bank assignment, bank-wide serviceable PIN restriction, accepted Home
    /// Types). Same JSON-string-array convention already used for
    /// EmpTypesJson/CompTypesJson on this same table. New, nullable columns
    /// only. No existing data affected. Safe on an existing production
    /// database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260812010000_AddBankLoanTypesPinsHomeTypes")]
    public partial class AddBankLoanTypesPinsHomeTypes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"ALTER TABLE ""Banks"" ADD COLUMN IF NOT EXISTS ""LoanTypesJson"" text;");
            migrationBuilder.Sql(@"ALTER TABLE ""Banks"" ADD COLUMN IF NOT EXISTS ""ServiceablePinsJson"" text;");
            migrationBuilder.Sql(@"ALTER TABLE ""Banks"" ADD COLUMN IF NOT EXISTS ""HomeTypesJson"" text;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"ALTER TABLE ""Banks"" DROP COLUMN IF EXISTS ""LoanTypesJson"";");
            migrationBuilder.Sql(@"ALTER TABLE ""Banks"" DROP COLUMN IF EXISTS ""ServiceablePinsJson"";");
            migrationBuilder.Sql(@"ALTER TABLE ""Banks"" DROP COLUMN IF EXISTS ""HomeTypesJson"";");
        }
    }
}
