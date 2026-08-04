using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Infrastructure;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <summary>
    /// Adds the AssignmentAuditLogs table backing the Auto Loan-Assignment
    /// audit trail. Previously this was ASSIGNMENT_AUDIT_LOG — a frontend-only
    /// in-memory array (`let ASSIGNMENT_AUDIT_LOG = []`) persisted only to the
    /// browser's localStorage — this migration is what makes it real,
    /// mirroring AddReportTargets / AddAssignmentLog. Additive only: new
    /// table, no changes to any existing table or column. Safe to apply on an
    /// existing production database; does not touch or reference any other
    /// table's data.
    /// </summary>
    /// <inheritdoc />
    [DbContext(typeof(LoanMS.Infrastructure.Data.AppDbContext))]
    [Migration("20260804000000_AddAssignmentAuditLog")]
    public partial class AddAssignmentAuditLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AssignmentAuditLogs",
                columns: table => new
                {
                    Id                 = table.Column<int>(type: "integer", nullable: false).Annotation("Npgsql:ValueGenerationStrategy", Npgsql.EntityFrameworkCore.PostgreSQL.Metadata.NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanApplicationId  = table.Column<int>(type: "integer", nullable: true),
                    LoanFrontendId     = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Location           = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    LoanType           = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: true),
                    SalesPerson        = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    SalesTeam          = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    AssignedToUserId   = table.Column<int>(type: "integer", nullable: true),
                    AssignedToUserName = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    AssignedByUserId   = table.Column<int>(type: "integer", nullable: true),
                    AssignedByName     = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Method             = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    TieBreak           = table.Column<bool>(type: "boolean", nullable: false),
                    PreviousUserName   = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    Reason             = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    CandidatesJson     = table.Column<string>(type: "text", nullable: true),
                    AssignedAt         = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAt          = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AssignmentAuditLogs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_AssignmentAuditLogs_Loans_LoanApplicationId",
                        column: x => x.LoanApplicationId,
                        principalTable: "Loans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AssignmentAuditLogs_LoanApplicationId",
                table: "AssignmentAuditLogs",
                column: "LoanApplicationId");

            migrationBuilder.CreateIndex(
                name: "IX_AssignmentAuditLogs_LoanFrontendId",
                table: "AssignmentAuditLogs",
                column: "LoanFrontendId");

            migrationBuilder.CreateIndex(
                name: "IX_AssignmentAuditLogs_AssignedAt",
                table: "AssignmentAuditLogs",
                column: "AssignedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "AssignmentAuditLogs");
        }
    }
}
