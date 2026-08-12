using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds the PerfiosReports table — bank-statement verification results
    /// (average balance, span, transaction count, salary-detected flag,
    /// validity, manual-review flag) previously existed ONLY as a JavaScript
    /// variable (window._perfiosBankDoc) in perfios-renderer.js. The entire
    /// ~9,200-line Perfios module never made a single API call — every
    /// verification result vanished on page refresh or when viewed from a
    /// different device/session. New, additive table only. No existing
    /// data affected. Safe on an existing production database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260812000000_AddPerfiosReports")]
    public partial class AddPerfiosReports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS ""PerfiosReports"" (
                    ""Id"" SERIAL PRIMARY KEY,
                    ""LoanId"" integer NOT NULL,
                    ""FileName"" character varying(255),
                    ""AverageBankBalance"" character varying(50),
                    ""Span"" character varying(50),
                    ""TotalTransactions"" integer,
                    ""HasSalary"" boolean NOT NULL DEFAULT false,
                    ""IsValid"" boolean NOT NULL DEFAULT false,
                    ""FirstTransactionDate"" character varying(50),
                    ""LastTransactionDate"" character varying(50),
                    ""ManualReviewRequired"" boolean NOT NULL DEFAULT false,
                    ""StaleDays"" integer,
                    ""VerifiedAt"" timestamp with time zone NOT NULL DEFAULT now(),
                    ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT now(),
                    ""UpdatedAt"" timestamp with time zone,
                    ""IsDeleted"" boolean NOT NULL DEFAULT false,
                    CONSTRAINT ""FK_PerfiosReports_Loans_LoanId"" FOREIGN KEY (""LoanId"") REFERENCES ""Loans"" (""Id"") ON DELETE CASCADE
                );");
            migrationBuilder.Sql("CREATE INDEX IF NOT EXISTS \"IX_PerfiosReports_LoanId\" ON \"PerfiosReports\" (\"LoanId\");");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS \"PerfiosReports\";");
        }
    }
}
