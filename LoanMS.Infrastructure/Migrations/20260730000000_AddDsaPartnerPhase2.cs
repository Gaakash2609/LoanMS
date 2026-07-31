using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Phase 2 — DSA/Partner complete server-side persistence.
    /// Adds the fields that were previously local-only (PAN, office address/
    /// state/pin/address-type, Category, Partner→DSA mapping) plus a new
    /// DsaDocuments table for uploaded KYC/onboarding documents.
    /// Additive only: new nullable columns + a new table. Does NOT touch
    /// existing tables/data, does NOT drop or recreate anything.
    /// Safe to apply on an existing production database.
    /// </summary>
    /// <inheritdoc />
    // PHASE 6 FIX: this migration was missing the [DbContext]/[Migration]
    // attributes that dotnet-ef normally generates (see PHASE6 report for
    // why this matters — without them EF Core cannot register/order this
    // migration for AppDbContext at runtime).
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260730000000_AddDsaPartnerPhase2")]
    public partial class AddDsaPartnerPhase2 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── DsaPartners: previously local-only fields ────────────────────────
            migrationBuilder.AddColumn<string>(
                name: "Pan",
                table: "DsaPartners",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OfficeAddress",
                table: "DsaPartners",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OfficeState",
                table: "DsaPartners",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OfficePin",
                table: "DsaPartners",
                type: "character varying(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "OfficeAddressType",
                table: "DsaPartners",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Category",
                table: "DsaPartners",
                type: "character varying(30)",
                maxLength: 30,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "MappedDsaId",
                table: "DsaPartners",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_DsaPartners_MappedDsaId",
                table: "DsaPartners",
                column: "MappedDsaId");

            // Self-referencing FK. SetNull — deleting/soft-deleting a DSA must
            // never cascade-delete or block-delete the Partners mapped to it.
            migrationBuilder.AddForeignKey(
                name: "FK_DsaPartners_DsaPartners_MappedDsaId",
                table: "DsaPartners",
                column: "MappedDsaId",
                principalTable: "DsaPartners",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            // ── DsaDocuments: uploaded KYC/onboarding documents ──────────────────
            migrationBuilder.CreateTable(
                name: "DsaDocuments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DsaPartnerId = table.Column<int>(type: "integer", nullable: false),
                    DocumentName = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    DocumentType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    FilePath = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    FileSizeBytes = table.Column<long>(type: "bigint", nullable: false),
                    UploadedByUserId = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false, defaultValue: ""),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DsaDocuments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DsaDocuments_DsaPartners_DsaPartnerId",
                        column: x => x.DsaPartnerId,
                        principalTable: "DsaPartners",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DsaDocuments_DsaPartnerId",
                table: "DsaDocuments",
                column: "DsaPartnerId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "DsaDocuments");

            migrationBuilder.DropForeignKey(name: "FK_DsaPartners_DsaPartners_MappedDsaId", table: "DsaPartners");
            migrationBuilder.DropIndex(name: "IX_DsaPartners_MappedDsaId", table: "DsaPartners");

            migrationBuilder.DropColumn(name: "MappedDsaId", table: "DsaPartners");
            migrationBuilder.DropColumn(name: "Category", table: "DsaPartners");
            migrationBuilder.DropColumn(name: "OfficeAddressType", table: "DsaPartners");
            migrationBuilder.DropColumn(name: "OfficePin", table: "DsaPartners");
            migrationBuilder.DropColumn(name: "OfficeState", table: "DsaPartners");
            migrationBuilder.DropColumn(name: "OfficeAddress", table: "DsaPartners");
            migrationBuilder.DropColumn(name: "Pan", table: "DsaPartners");
        }
    }
}
