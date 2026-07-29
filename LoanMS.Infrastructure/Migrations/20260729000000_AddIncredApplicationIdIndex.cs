using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds an index on Loans.IncredApplicationId. The InCred webhook receiver
    /// (POST /incred/loan/webhook) now looks up the owning Loan by this column
    /// on every inbound callback (to sync IncredLastWebhookEvent/Status) — this
    /// was previously an unindexed lookup. Additive only, safe on an existing
    /// production database.
    /// </summary>
    /// <inheritdoc />
    public partial class AddIncredApplicationIdIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Loans_IncredApplicationId",
                table: "Loans",
                column: "IncredApplicationId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Loans_IncredApplicationId",
                table: "Loans");
        }
    }
}
