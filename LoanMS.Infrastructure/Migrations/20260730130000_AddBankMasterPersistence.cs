using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Phase 5B — Banks: full database persistence.
    ///
    /// Adds the Banks table backing the Banks master-data screen (bank name,
    /// IFSC prefix, employee code, RM contact details). Previously this screen
    /// had a frontend API contract (/api/banks) but no backing table — this
    /// migration is what makes it real. Additive only: new table, no changes
    /// to any existing table or column. Safe to apply on an existing
    /// production database; does not touch or reference any other table, so
    /// no existing Loan/Customer/Payout/Report data or relationships are
    /// affected.
    /// </summary>
    /// <inheritdoc />
    // PHASE 6 FIX: this migration was missing the [DbContext]/[Migration]
    // attributes that dotnet-ef normally generates (see PHASE6 report for
    // why this matters — without them EF Core cannot register/order this
    // migration for AppDbContext at runtime).
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260730130000_AddBankMasterPersistence")]
    public partial class AddBankMasterPersistence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Banks",
                columns: table => new
                {
                    Id              = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    BankName        = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    IfscPrefix      = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    EmpCode         = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    Location        = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    RmName          = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    RmMobile        = table.Column<string>(type: "character varying(15)", maxLength: 15, nullable: true),
                    Email           = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Remarks         = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IsActive        = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt       = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt       = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted       = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Banks", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Banks_BankName_Unique_Active",
                table: "Banks",
                column: "BankName",
                unique: true,
                filter: "\"IsDeleted\" = false");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "Banks");
        }
    }
}
