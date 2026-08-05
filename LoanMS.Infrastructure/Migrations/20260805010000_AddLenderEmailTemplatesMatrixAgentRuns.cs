using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds LenderEmailThreadEntries (lender RM email conversation log),
    /// EmailTemplates (admin-customized auto-send subject/body),
    /// ProductOfferMatrices (per-product First Offer matrix), and
    /// AiAgentRuns (Akshiv agent run history). All four were previously
    /// localStorage-only. Additive only: new tables, no changes to any
    /// existing table or column. Safe to apply on an existing production
    /// database.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260805010000_AddLenderEmailTemplatesMatrixAgentRuns")]
    public partial class AddLenderEmailTemplatesMatrixAgentRuns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "LenderEmailThreadEntries",
                columns: table => new
                {
                    Id                = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanApplicationId = table.Column<int>(type: "integer", nullable: false),
                    Direction         = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Stage             = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    RmName            = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    RmEmail           = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Subject           = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    BodyText          = table.Column<string>(type: "text", nullable: true),
                    Source            = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    ParsedDataJson    = table.Column<string>(type: "text", nullable: true),
                    CreatedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted         = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LenderEmailThreadEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LenderEmailThreadEntries_Loans_LoanApplicationId",
                        column: x => x.LoanApplicationId,
                        principalTable: "Loans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LenderEmailThreadEntries_LoanApplicationId",
                table: "LenderEmailThreadEntries",
                column: "LoanApplicationId");

            migrationBuilder.CreateTable(
                name: "EmailTemplates",
                columns: table => new
                {
                    Id          = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TemplateKey = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Subject     = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Body        = table.Column<string>(type: "text", nullable: false),
                    CreatedAt   = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt   = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted   = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailTemplates", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmailTemplates_TemplateKey",
                table: "EmailTemplates",
                column: "TemplateKey",
                unique: true,
                filter: "\"IsDeleted\" = false");

            migrationBuilder.CreateTable(
                name: "ProductOfferMatrices",
                columns: table => new
                {
                    Id         = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ProductKey = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    MatrixJson = table.Column<string>(type: "text", nullable: false),
                    CreatedAt  = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt  = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted  = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProductOfferMatrices", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProductOfferMatrices_ProductKey",
                table: "ProductOfferMatrices",
                column: "ProductKey",
                unique: true,
                filter: "\"IsDeleted\" = false");

            migrationBuilder.CreateTable(
                name: "AiAgentRuns",
                columns: table => new
                {
                    Id                = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanApplicationId = table.Column<int>(type: "integer", nullable: false),
                    RunId             = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    StartedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    FinishedAt        = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Status            = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Error             = table.Column<string>(type: "text", nullable: true),
                    StepsJson         = table.Column<string>(type: "text", nullable: true),
                    CreatedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted         = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AiAgentRuns", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AiAgentRuns_Loans_LoanApplicationId",
                        column: x => x.LoanApplicationId,
                        principalTable: "Loans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AiAgentRuns_LoanApplicationId",
                table: "AiAgentRuns",
                column: "LoanApplicationId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "LenderEmailThreadEntries");
            migrationBuilder.DropTable(name: "EmailTemplates");
            migrationBuilder.DropTable(name: "ProductOfferMatrices");
            migrationBuilder.DropTable(name: "AiAgentRuns");
        }
    }
}
