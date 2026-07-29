using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Phase 1 — DSA/Partner login linkage and Loan-side FK placeholders.
    /// Additive only: new nullable columns + new FKs/indexes.
    /// Does NOT touch existing tables/data, does NOT drop or recreate anything.
    /// Safe to apply on an existing production database.
    /// </summary>
    /// <inheritdoc />
    public partial class AddDsaPartnerPhase1 : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // ── DsaPartners: classify as Dsa/Partner + optional linked login ────────
            migrationBuilder.AddColumn<string>(
                name: "PartnerType",
                table: "DsaPartners",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Dsa");

            migrationBuilder.AddColumn<int>(
                name: "LinkedUserId",
                table: "DsaPartners",
                type: "integer",
                nullable: true);

            // ── Loans: optional DSA / Partner / Location association ────────────────
            migrationBuilder.AddColumn<int>(
                name: "DsaId",
                table: "Loans",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "PartnerId",
                table: "Loans",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "LocationId",
                table: "Loans",
                type: "integer",
                nullable: true);

            // ── Indexes ───────────────────────────────────────────────────────────
            migrationBuilder.CreateIndex("IX_DsaPartners_LinkedUserId", "DsaPartners", "LinkedUserId");
            migrationBuilder.CreateIndex("IX_Loans_DsaId",              "Loans",       "DsaId");
            migrationBuilder.CreateIndex("IX_Loans_PartnerId",          "Loans",       "PartnerId");
            migrationBuilder.CreateIndex("IX_Loans_LocationId",         "Loans",       "LocationId");

            // ── Foreign Keys (all nullable / SetNull — never blocks deletes) ────────
            migrationBuilder.AddForeignKey(
                name: "FK_DsaPartners_Users_LinkedUserId",
                table: "DsaPartners",
                column: "LinkedUserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Loans_DsaPartners_DsaId",
                table: "Loans",
                column: "DsaId",
                principalTable: "DsaPartners",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Loans_DsaPartners_PartnerId",
                table: "Loans",
                column: "PartnerId",
                principalTable: "DsaPartners",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);

            migrationBuilder.AddForeignKey(
                name: "FK_Loans_Locations_LocationId",
                table: "Loans",
                column: "LocationId",
                principalTable: "Locations",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(name: "FK_Loans_Locations_LocationId", table: "Loans");
            migrationBuilder.DropForeignKey(name: "FK_Loans_DsaPartners_PartnerId", table: "Loans");
            migrationBuilder.DropForeignKey(name: "FK_Loans_DsaPartners_DsaId", table: "Loans");
            migrationBuilder.DropForeignKey(name: "FK_DsaPartners_Users_LinkedUserId", table: "DsaPartners");

            migrationBuilder.DropIndex(name: "IX_Loans_LocationId", table: "Loans");
            migrationBuilder.DropIndex(name: "IX_Loans_PartnerId", table: "Loans");
            migrationBuilder.DropIndex(name: "IX_Loans_DsaId", table: "Loans");
            migrationBuilder.DropIndex(name: "IX_DsaPartners_LinkedUserId", table: "DsaPartners");

            migrationBuilder.DropColumn(name: "LocationId", table: "Loans");
            migrationBuilder.DropColumn(name: "PartnerId", table: "Loans");
            migrationBuilder.DropColumn(name: "DsaId", table: "Loans");
            migrationBuilder.DropColumn(name: "LinkedUserId", table: "DsaPartners");
            migrationBuilder.DropColumn(name: "PartnerType", table: "DsaPartners");
        }
    }
}
