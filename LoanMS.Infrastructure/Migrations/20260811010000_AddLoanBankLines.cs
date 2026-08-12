using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds the LoanBankLines table — per-bank lender-processing details
    /// (Bank Name, Application Number, Approved Loan, Remarks) on the
    /// Applications detail page's "Bank Details" table had no backend
    /// representation at all: an entry appeared to save (it updated the
    /// on-screen row and showed a "saved" toast) but silently reverted on
    /// refresh or a different device, since there was nowhere for it to
    /// persist. New, additive table only. No existing data affected. Safe
    /// on an existing production database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260811010000_AddLoanBankLines")]
    public partial class AddLoanBankLines : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS ""LoanBankLines"" (
                    ""Id"" SERIAL PRIMARY KEY,
                    ""LoanId"" integer NOT NULL,
                    ""BankName"" character varying(200) NOT NULL DEFAULT '',
                    ""TempApplicationNumber"" character varying(50) NOT NULL DEFAULT '',
                    ""ApplicationNumber"" character varying(100),
                    ""ApprovedLoan"" numeric(18,2),
                    ""Remarks"" character varying(500),
                    ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT now(),
                    ""UpdatedAt"" timestamp with time zone,
                    ""IsDeleted"" boolean NOT NULL DEFAULT false,
                    CONSTRAINT ""FK_LoanBankLines_Loans_LoanId"" FOREIGN KEY (""LoanId"") REFERENCES ""Loans"" (""Id"") ON DELETE CASCADE
                );");
            migrationBuilder.Sql("CREATE INDEX IF NOT EXISTS \"IX_LoanBankLines_LoanId\" ON \"LoanBankLines\" (\"LoanId\");");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS \"LoanBankLines\";");
        }
    }
}
