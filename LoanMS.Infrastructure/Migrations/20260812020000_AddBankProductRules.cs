using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds the BankProductRules table — per-product-type (Personal Loan vs
    /// Business Loan, etc.) variation of a bank's eligibility rules, the
    /// frontend's bank.productRules[productKey]. Confirmed local-only.
    /// New, additive table only. No existing data affected. Safe on an
    /// existing production database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260812020000_AddBankProductRules")]
    public partial class AddBankProductRules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
                CREATE TABLE IF NOT EXISTS ""BankProductRules"" (
                    ""Id"" SERIAL PRIMARY KEY,
                    ""BankId"" integer NOT NULL,
                    ""ProductKey"" character varying(50) NOT NULL,
                    ""MinCibil"" integer,
                    ""AcceptNtc"" boolean NOT NULL DEFAULT false,
                    ""MaxLoanAmt"" numeric(18,2),
                    ""MinTenure"" integer,
                    ""MaxTenure"" integer,
                    ""FoirLimit"" integer,
                    ""PfRequired"" boolean NOT NULL DEFAULT false,
                    ""MinAge"" integer,
                    ""MaxAge"" integer,
                    ""MinExpMonths"" integer,
                    ""EmpTypesJson"" text NOT NULL DEFAULT '[]',
                    ""CompTypesJson"" text NOT NULL DEFAULT '[]',
                    ""HomeTypesJson"" text NOT NULL DEFAULT '[]',
                    ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT now(),
                    ""UpdatedAt"" timestamp with time zone,
                    ""IsDeleted"" boolean NOT NULL DEFAULT false,
                    CONSTRAINT ""FK_BankProductRules_Banks_BankId"" FOREIGN KEY (""BankId"") REFERENCES ""Banks"" (""Id"") ON DELETE CASCADE
                );");
            migrationBuilder.Sql("CREATE UNIQUE INDEX IF NOT EXISTS \"IX_BankProductRules_BankId_ProductKey\" ON \"BankProductRules\" (\"BankId\", \"ProductKey\");");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP TABLE IF EXISTS \"BankProductRules\";");
        }
    }
}
