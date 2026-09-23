using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPerfiosEvidenceAuthority : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "BankStatementDocumentId",
                table: "PerfiosReports",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EvidenceSource",
                table: "PerfiosReports",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                // Gap-1: existing (and new) reports default to client-parsed / untrusted.
                defaultValue: "ClientParsed");

            migrationBuilder.AddColumn<string>(
                name: "SourcePdfHash",
                table: "PerfiosReports",
                type: "character varying(128)",
                maxLength: 128,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_PerfiosReports_BankStatementDocumentId",
                table: "PerfiosReports",
                column: "BankStatementDocumentId");

            migrationBuilder.AddForeignKey(
                name: "FK_PerfiosReports_LoanDocuments_BankStatementDocumentId",
                table: "PerfiosReports",
                column: "BankStatementDocumentId",
                principalTable: "LoanDocuments",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PerfiosReports_LoanDocuments_BankStatementDocumentId",
                table: "PerfiosReports");

            migrationBuilder.DropIndex(
                name: "IX_PerfiosReports_BankStatementDocumentId",
                table: "PerfiosReports");

            migrationBuilder.DropColumn(
                name: "BankStatementDocumentId",
                table: "PerfiosReports");

            migrationBuilder.DropColumn(
                name: "EvidenceSource",
                table: "PerfiosReports");

            migrationBuilder.DropColumn(
                name: "SourcePdfHash",
                table: "PerfiosReports");
        }
    }
}
