using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds the LoanSanctionDetails table — the "Approval Details" panel's
    /// Stamp Duty/GST/Insurance/PF%/Bundled/BT/Flat Rate/EMI Date fields,
    /// confirmed local-only (approvalFieldSave() in efin-app.js never
    /// called an API). New, additive table only. No existing data
    /// affected. Safe on an existing production database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260812040000_AddLoanSanctionDetails")]
    public partial class AddLoanSanctionDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS ""LoanSanctionDetails"" (
                    ""Id"" SERIAL PRIMARY KEY,
                    ""LoanId"" integer NOT NULL,
                    ""StampDuty"" character varying(100),
                    ""Gst"" numeric(18,2),
                    ""Insurance"" numeric(18,2),
                    ""PfPercent"" numeric(5,2),
                    ""InsuranceInBundled"" boolean NOT NULL DEFAULT false,
                    ""PfInBundled"" boolean NOT NULL DEFAULT false,
                    ""IsBundled"" boolean NOT NULL DEFAULT false,
                    ""IsBt"" boolean NOT NULL DEFAULT false,
                    ""FlatRate"" numeric(5,2),
                    ""EmiDate"" timestamp with time zone,
                    ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT now(),
                    ""UpdatedAt"" timestamp with time zone,
                    ""IsDeleted"" boolean NOT NULL DEFAULT false,
                    CONSTRAINT ""FK_LoanSanctionDetails_Loans_LoanId"" FOREIGN KEY (""LoanId"") REFERENCES ""Loans"" (""Id"") ON DELETE CASCADE
                );");
            migrationBuilder.Sql("CREATE UNIQUE INDEX IF NOT EXISTS \"IX_LoanSanctionDetails_LoanId\" ON \"LoanSanctionDetails\" (\"LoanId\");");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS \"LoanSanctionDetails\";");
        }
    }
}
