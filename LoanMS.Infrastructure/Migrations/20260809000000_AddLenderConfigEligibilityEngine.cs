using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Lender Configuration — eligibility engine, full database persistence.
    ///
    /// The Lender Configuration screen and the Wizard's Step 9 bank-matching
    /// (efin-app.js's LA_DB object) previously had NO backing table at all —
    /// every bank eligibility rule, approved company, salary category, and
    /// company/category/PIN "line" an admin configured only ever lived in
    /// browser memory, and was gone on the next page refresh. This migration
    /// is what makes that data real:
    ///   - Extends the existing Banks table with the eligibility-rule fields
    ///     (MinCibil, MaxLoanAmt, FOIR limit, employment types accepted, etc)
    ///   - AnalyticCompanies: the approved-employer master list
    ///   - AnalyticCategories: the salary-tier master list (Gold/Silver/...)
    ///   - BankEligibilityLines: the Bank+Company+Category+PIN+PF rows that
    ///     make up a bank's "Path A — Company List" eligibility matrix
    ///
    /// Additive only — new columns (all nullable/defaulted) and new tables.
    /// No existing column changes, no data migration needed (this data
    /// literally did not exist in the database before). Safe to apply on an
    /// existing production database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260809000000_AddLenderConfigEligibilityEngine")]
    public partial class AddLenderConfigEligibilityEngine : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── Extend Banks with eligibility-rule fields ────────────────────────
            migrationBuilder.Sql("ALTER TABLE \"Banks\" ADD COLUMN IF NOT EXISTS \"IsIncred\" boolean NOT NULL DEFAULT false;");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" ADD COLUMN IF NOT EXISTS \"IsElite\" boolean NOT NULL DEFAULT false;");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" ADD COLUMN IF NOT EXISTS \"MinCibil\" integer NOT NULL DEFAULT 700;");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" ADD COLUMN IF NOT EXISTS \"AcceptNtc\" boolean NOT NULL DEFAULT false;");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" ADD COLUMN IF NOT EXISTS \"MaxLoanAmt\" numeric NOT NULL DEFAULT 5000000;");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" ADD COLUMN IF NOT EXISTS \"MinTenure\" integer NOT NULL DEFAULT 12;");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" ADD COLUMN IF NOT EXISTS \"MaxTenure\" integer NOT NULL DEFAULT 60;");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" ADD COLUMN IF NOT EXISTS \"FoirLimit\" integer NOT NULL DEFAULT 50;");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" ADD COLUMN IF NOT EXISTS \"PfRequired\" boolean NOT NULL DEFAULT false;");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" ADD COLUMN IF NOT EXISTS \"MinAge\" integer NOT NULL DEFAULT 21;");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" ADD COLUMN IF NOT EXISTS \"MaxAge\" integer NOT NULL DEFAULT 60;");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" ADD COLUMN IF NOT EXISTS \"MinExpMonths\" integer NOT NULL DEFAULT 6;");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" ADD COLUMN IF NOT EXISTS \"EmpTypesJson\" text NOT NULL DEFAULT '[]';");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" ADD COLUMN IF NOT EXISTS \"CompTypesJson\" text NOT NULL DEFAULT '[]';");

            // ── AnalyticCompanies ─────────────────────────────────────────────────
            migrationBuilder.CreateTable(
                name: "AnalyticCompanies",
                columns: table => new
                {
                    Id           = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name         = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    EmpTypesJson = table.Column<string>(type: "text", nullable: false, defaultValue: "[]"),
                    CompType     = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    CreatedAt    = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt    = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted    = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table => { table.PrimaryKey("PK_AnalyticCompanies", x => x.Id); });

            // ── AnalyticCategories ────────────────────────────────────────────────
            migrationBuilder.CreateTable(
                name: "AnalyticCategories",
                columns: table => new
                {
                    Id        = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name      = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Salary    = table.Column<decimal>(type: "numeric", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table => { table.PrimaryKey("PK_AnalyticCategories", x => x.Id); });

            // ── BankEligibilityLines ──────────────────────────────────────────────
            migrationBuilder.CreateTable(
                name: "BankEligibilityLines",
                columns: table => new
                {
                    Id         = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    BankId     = table.Column<int>(type: "integer", nullable: false),
                    CompanyId  = table.Column<int>(type: "integer", nullable: false),
                    CategoryId = table.Column<int>(type: "integer", nullable: false),
                    PinCode    = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    Pf         = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    CreatedAt  = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt  = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted  = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BankEligibilityLines", x => x.Id);
                    table.ForeignKey("FK_BankEligibilityLines_Banks_BankId", x => x.BankId, "Banks", "Id", onDelete: ReferentialAction.Cascade);
                    table.ForeignKey("FK_BankEligibilityLines_AnalyticCompanies_CompanyId", x => x.CompanyId, "AnalyticCompanies", "Id", onDelete: ReferentialAction.Restrict);
                    table.ForeignKey("FK_BankEligibilityLines_AnalyticCategories_CategoryId", x => x.CategoryId, "AnalyticCategories", "Id", onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(name: "IX_BankEligibilityLines_BankId", table: "BankEligibilityLines", column: "BankId");
            migrationBuilder.CreateIndex(name: "IX_BankEligibilityLines_CompanyId", table: "BankEligibilityLines", column: "CompanyId");
            migrationBuilder.CreateIndex(name: "IX_BankEligibilityLines_CategoryId", table: "BankEligibilityLines", column: "CategoryId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "BankEligibilityLines");
            migrationBuilder.DropTable(name: "AnalyticCategories");
            migrationBuilder.DropTable(name: "AnalyticCompanies");

            migrationBuilder.Sql("ALTER TABLE \"Banks\" DROP COLUMN IF EXISTS \"IsIncred\";");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" DROP COLUMN IF EXISTS \"IsElite\";");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" DROP COLUMN IF EXISTS \"MinCibil\";");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" DROP COLUMN IF EXISTS \"AcceptNtc\";");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" DROP COLUMN IF EXISTS \"MaxLoanAmt\";");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" DROP COLUMN IF EXISTS \"MinTenure\";");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" DROP COLUMN IF EXISTS \"MaxTenure\";");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" DROP COLUMN IF EXISTS \"FoirLimit\";");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" DROP COLUMN IF EXISTS \"PfRequired\";");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" DROP COLUMN IF EXISTS \"MinAge\";");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" DROP COLUMN IF EXISTS \"MaxAge\";");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" DROP COLUMN IF EXISTS \"MinExpMonths\";");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" DROP COLUMN IF EXISTS \"EmpTypesJson\";");
            migrationBuilder.Sql("ALTER TABLE \"Banks\" DROP COLUMN IF EXISTS \"CompTypesJson\";");
        }
    }
}
