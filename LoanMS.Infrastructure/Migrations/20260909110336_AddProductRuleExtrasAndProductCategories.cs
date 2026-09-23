using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddProductRuleExtrasAndProductCategories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // NOTE: This migration is deliberately scoped to the Lender-Config
            // additions only (BankProductRule extras + BankProductCategories).
            // `dotnet ef` also flagged 4 pre-existing Loans columns
            // (CustomerAgreementDone / NachDone / PreRejectedStatus / RejectedAt)
            // that were added to the entity earlier without a migration — that
            // is unrelated snapshot drift and out of scope here, so those
            // AddColumn calls (and the snapshot entries for them) were removed
            // to avoid an unrelated Loans schema change riding along.
            migrationBuilder.AddColumn<int>(
                name: "BankStmtMonths",
                table: "BankProductRules",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "BounceTolerance",
                table: "BankProductRules",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MinAcctVintage",
                table: "BankProductRules",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "MinAvgBalance",
                table: "BankProductRules",
                type: "numeric(18,2)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MinCreditScore",
                table: "BankProductRules",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "MinTurnover",
                table: "BankProductRules",
                type: "numeric(18,2)",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MinVintage",
                table: "BankProductRules",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "BankProductCategories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    BankId = table.Column<int>(type: "integer", nullable: false),
                    ProductKey = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    MinTurnover = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Color = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Notes = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BankProductCategories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BankProductCategories_Banks_BankId",
                        column: x => x.BankId,
                        principalTable: "Banks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BankProductCategories_BankId_ProductKey",
                table: "BankProductCategories",
                columns: new[] { "BankId", "ProductKey" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BankProductCategories");

            migrationBuilder.DropColumn(
                name: "BankStmtMonths",
                table: "BankProductRules");

            migrationBuilder.DropColumn(
                name: "BounceTolerance",
                table: "BankProductRules");

            migrationBuilder.DropColumn(
                name: "MinAcctVintage",
                table: "BankProductRules");

            migrationBuilder.DropColumn(
                name: "MinAvgBalance",
                table: "BankProductRules");

            migrationBuilder.DropColumn(
                name: "MinCreditScore",
                table: "BankProductRules");

            migrationBuilder.DropColumn(
                name: "MinTurnover",
                table: "BankProductRules");

            migrationBuilder.DropColumn(
                name: "MinVintage",
                table: "BankProductRules");
        }
    }
}
