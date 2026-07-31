using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <inheritdoc />
    // PHASE 6 FIX: this migration was missing the [DbContext]/[Migration]
    // attributes that dotnet-ef normally generates (see PHASE6 report for
    // why this matters — without them EF Core cannot register/order this
    // migration for AppDbContext at runtime).
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260726000000_AddIncredIntegration")]
    public partial class AddIncredIntegration : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ApplicationSource",
                table: "Loans",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IncredApplicationId",
                table: "Loans",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IncredCustomerId",
                table: "Loans",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IncredRequestId",
                table: "Loans",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IncredOfferStatus",
                table: "Loans",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IncredOfferJson",
                table: "Loans",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IncredErrorMessage",
                table: "Loans",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IncredRejectReason",
                table: "Loans",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IncredLastWebhookEvent",
                table: "Loans",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "IncredLastWebhookStatus",
                table: "Loans",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "IncredLastSyncedAt",
                table: "Loans",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "LoanOffers",
                columns: table => new
                {
                    Id            = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanId        = table.Column<int>(type: "integer", nullable: false),
                    OfferType     = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    LoanAmount    = table.Column<decimal>(type: "decimal(18,2)", nullable: false),
                    LoanMaxTenure = table.Column<int>(type: "integer", nullable: false),
                    LoanRate      = table.Column<decimal>(type: "decimal(5,2)", nullable: false),
                    ProcessingFee = table.Column<decimal>(type: "decimal(5,2)", nullable: false),
                    CreatedAt     = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt     = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted     = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LoanOffers", x => x.Id);
                    table.ForeignKey("FK_LoanOffers_Loans_LoanId", x => x.LoanId, "Loans", "Id", onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LoanOffers_LoanId",
                table: "LoanOffers",
                column: "LoanId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "LoanOffers");

            migrationBuilder.DropColumn(name: "ApplicationSource", table: "Loans");
            migrationBuilder.DropColumn(name: "IncredApplicationId", table: "Loans");
            migrationBuilder.DropColumn(name: "IncredCustomerId", table: "Loans");
            migrationBuilder.DropColumn(name: "IncredRequestId", table: "Loans");
            migrationBuilder.DropColumn(name: "IncredOfferStatus", table: "Loans");
            migrationBuilder.DropColumn(name: "IncredOfferJson", table: "Loans");
            migrationBuilder.DropColumn(name: "IncredErrorMessage", table: "Loans");
            migrationBuilder.DropColumn(name: "IncredRejectReason", table: "Loans");
            migrationBuilder.DropColumn(name: "IncredLastWebhookEvent", table: "Loans");
            migrationBuilder.DropColumn(name: "IncredLastWebhookStatus", table: "Loans");
            migrationBuilder.DropColumn(name: "IncredLastSyncedAt", table: "Loans");
        }
    }
}
