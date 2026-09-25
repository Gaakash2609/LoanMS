using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace LoanMS.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddOfferWorkflowAndStatusChecks : Migration
    {
        // LoanStatus names at the time of this migration (NI / Cancelled are not among them).
        private const string StatusList =
            "'Draft', 'Submitted', 'UnderReview', 'Approved', 'Rejected', 'Disbursed', 'Closed', 'OnHold', 'Decision', 'Acceptance', 'Offer'";

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {

            // ── NI / Not Interested / Cancelled removal (application level) ──────
            // These were never valid LoanStatus values in the backend; the CHECK
            // constraints below make them impossible from here on. The database is
            // expected to hold no such rows (verified empty before this release), so
            // instead of silently deleting financial/audit records this migration
            // REFUSES to run if any row still carries a status outside the enum —
            // the operator must restore from the pre-migration backup and decide.
            // (Sanction Cancel/Revoke is a separate Sanctions.Status value, not an
            // application status.)
            if (migrationBuilder.ActiveProvider == "Npgsql.EntityFrameworkCore.PostgreSQL")
            {
                migrationBuilder.Sql(@"
DO $$
DECLARE bad_loans int; bad_hist int;
BEGIN
  SELECT count(*) INTO bad_loans FROM ""Loans""
   WHERE ""Status"" NOT IN (" + StatusList + @")
      OR (""PreRejectedStatus"" IS NOT NULL AND ""PreRejectedStatus"" NOT IN (" + StatusList + @"));
  SELECT count(*) INTO bad_hist FROM ""LoanStatusHistories""
   WHERE ""FromStatus"" NOT IN (" + StatusList + @") OR ""ToStatus"" NOT IN (" + StatusList + @");
  IF bad_loans > 0 OR bad_hist > 0 THEN
    RAISE EXCEPTION 'NI/Cancelled removal: % loan row(s) and % status-history row(s) carry a status outside LoanStatus (e.g. NI / Cancelled). Resolve them from the backup before migrating.', bad_loans, bad_hist;
  END IF;
END $$;");
            }
            migrationBuilder.CreateTable(
                name: "ApplicationOffers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanId = table.Column<int>(type: "integer", nullable: false),
                    BankId = table.Column<int>(type: "integer", nullable: false),
                    LenderName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ProductKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    LoanType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    DeviationStatus = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ApprovalStatus = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CurrentRevisionNo = table.Column<int>(type: "integer", nullable: false),
                    ValidUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    SelectedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SelectedByUserId = table.Column<int>(type: "integer", nullable: true),
                    SelectedRevisionNo = table.Column<int>(type: "integer", nullable: true),
                    StatusReason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: false),
                    UpdatedByUserId = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ApplicationOffers", x => x.Id);
                    table.CheckConstraint("CK_ApplicationOffers_ApprovalStatus", "\"ApprovalStatus\" IN ('Pending', 'Approved', 'Rejected')");
                    table.CheckConstraint("CK_ApplicationOffers_DeviationStatus", "\"DeviationStatus\" IN ('NotRequired', 'Required', 'Raised', 'Approved', 'Rejected', 'Skipped')");
                    table.CheckConstraint("CK_ApplicationOffers_FinalSelection", "\"Status\" <> 'Final' OR (\"SelectedAt\" IS NOT NULL AND \"SelectedRevisionNo\" IS NOT NULL)");
                    table.CheckConstraint("CK_ApplicationOffers_Status", "\"Status\" IN ('Available', 'Final', 'NotSelected', 'Withdrawn', 'Expired')");
                    table.ForeignKey(
                        name: "FK_ApplicationOffers_Banks_BankId",
                        column: x => x.BankId,
                        principalTable: "Banks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ApplicationOffers_Loans_LoanId",
                        column: x => x.LoanId,
                        principalTable: "Loans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_ApplicationOffers_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "DeviationRules",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    RuleKey = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    BankId = table.Column<int>(type: "integer", nullable: false),
                    ProductKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    LoanType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    DeviationType = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Metric = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    LimitValue = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    MaxApprovableDeviation = table.Column<decimal>(type: "numeric(18,2)", nullable: true),
                    ConditionsJson = table.Column<string>(type: "text", nullable: false),
                    ConditionLogic = table.Column<string>(type: "character varying(3)", maxLength: 3, nullable: false),
                    Priority = table.Column<int>(type: "integer", nullable: false),
                    EffectiveFrom = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    EffectiveTo = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    ApprovalRequired = table.Column<bool>(type: "boolean", nullable: false),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SupersededAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeactivatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeactivatedByUserId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeviationRules", x => x.Id);
                    table.CheckConstraint("CK_DeviationRules_Dates", "\"EffectiveTo\" IS NULL OR \"EffectiveTo\" >= \"EffectiveFrom\"");
                    table.CheckConstraint("CK_DeviationRules_Logic", "\"ConditionLogic\" IN ('AND', 'OR')");
                    table.ForeignKey(
                        name: "FK_DeviationRules_Banks_BankId",
                        column: x => x.BankId,
                        principalTable: "Banks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "ApplicationOfferRevisions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    OfferId = table.Column<int>(type: "integer", nullable: false),
                    RevisionNo = table.Column<int>(type: "integer", nullable: false),
                    LoanAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    TenureMonths = table.Column<int>(type: "integer", nullable: false),
                    BaseRoi = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    OfferedRoi = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    RateType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ProcessingFeePct = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    ProcessingFeeAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    GstPct = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    GstAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    InsuranceAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    PfInBundled = table.Column<bool>(type: "boolean", nullable: false),
                    InsuranceInBundled = table.Column<bool>(type: "boolean", nullable: false),
                    BtAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    StampDuty = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    FinancedPrincipal = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    Emi = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    NetDisbursement = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    ChangeReason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    EvaluationJson = table.Column<string>(type: "text", nullable: true),
                    EvaluationOutcome = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ApplicationOfferRevisions", x => x.Id);
                    table.CheckConstraint("CK_OfferRevisions_Positive", "\"LoanAmount\" > 0 AND \"TenureMonths\" > 0 AND \"OfferedRoi\" >= 0 AND \"NetDisbursement\" > 0");
                    table.ForeignKey(
                        name: "FK_ApplicationOfferRevisions_ApplicationOffers_OfferId",
                        column: x => x.OfferId,
                        principalTable: "ApplicationOffers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "CreditApprovals",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanId = table.Column<int>(type: "integer", nullable: false),
                    OfferId = table.Column<int>(type: "integer", nullable: false),
                    RevisionNo = table.Column<int>(type: "integer", nullable: false),
                    BankId = table.Column<int>(type: "integer", nullable: false),
                    LenderName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Decision = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Comment = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    TermsSnapshotJson = table.Column<string>(type: "text", nullable: false),
                    DeviationRefsJson = table.Column<string>(type: "text", nullable: true),
                    DeviationStatusAtApproval = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ApproverUserId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    IsCurrent = table.Column<bool>(type: "boolean", nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CreditApprovals", x => x.Id);
                    table.CheckConstraint("CK_CreditApprovals_Decision", "\"Decision\" IN ('Approved', 'Rejected')");
                    table.ForeignKey(
                        name: "FK_CreditApprovals_ApplicationOffers_OfferId",
                        column: x => x.OfferId,
                        principalTable: "ApplicationOffers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CreditApprovals_Loans_LoanId",
                        column: x => x.LoanId,
                        principalTable: "Loans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_CreditApprovals_Users_ApproverUserId",
                        column: x => x.ApproverUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "OfferDeviations",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanId = table.Column<int>(type: "integer", nullable: false),
                    OfferId = table.Column<int>(type: "integer", nullable: false),
                    RevisionNo = table.Column<int>(type: "integer", nullable: false),
                    BankId = table.Column<int>(type: "integer", nullable: false),
                    DeviationType = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Source = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Reason = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    RuleSnapshotJson = table.Column<string>(type: "text", nullable: true),
                    OfferSnapshotJson = table.Column<string>(type: "text", nullable: true),
                    RaisedByUserId = table.Column<int>(type: "integer", nullable: false),
                    RaisedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    AssignedApproverId = table.Column<int>(type: "integer", nullable: true),
                    AssignmentState = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    DecidedByUserId = table.Column<int>(type: "integer", nullable: true),
                    DecidedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DecisionComment = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    ClosedReason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    IdempotencyKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    DecisionIdempotencyKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    TaskId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OfferDeviations", x => x.Id);
                    table.CheckConstraint("CK_OfferDeviations_NoSelfApproval", "\"Status\" <> 'Approved' OR \"DecidedByUserId\" <> \"RaisedByUserId\"");
                    table.CheckConstraint("CK_OfferDeviations_Status", "\"Status\" IN ('Raised', 'Approved', 'Rejected', 'Skipped', 'Closed')");
                    table.ForeignKey(
                        name: "FK_OfferDeviations_ApplicationOffers_OfferId",
                        column: x => x.OfferId,
                        principalTable: "ApplicationOffers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OfferDeviations_Loans_LoanId",
                        column: x => x.LoanId,
                        principalTable: "Loans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OfferDeviations_Users_RaisedByUserId",
                        column: x => x.RaisedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Sanctions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanId = table.Column<int>(type: "integer", nullable: false),
                    SanctionNumber = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    SanctionVersion = table.Column<int>(type: "integer", nullable: false),
                    PreviousSanctionId = table.Column<int>(type: "integer", nullable: true),
                    OfferId = table.Column<int>(type: "integer", nullable: false),
                    RevisionNo = table.Column<int>(type: "integer", nullable: false),
                    CreditApprovalId = table.Column<int>(type: "integer", nullable: false),
                    BankId = table.Column<int>(type: "integer", nullable: false),
                    LenderName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    LoanAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    TenureMonths = table.Column<int>(type: "integer", nullable: false),
                    Roi = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    Emi = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    ProcessingFeePct = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    ProcessingFeeAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    GstPct = table.Column<decimal>(type: "numeric(5,2)", nullable: false),
                    GstAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    InsuranceAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    BtAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    StampDuty = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    FinancedPrincipal = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    NetDisbursement = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    DeviationRefsJson = table.Column<string>(type: "text", nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    GeneratedByUserId = table.Column<int>(type: "integer", nullable: false),
                    GeneratedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CancellationType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    CancelReason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CancelledByUserId = table.Column<int>(type: "integer", nullable: true),
                    CancelledAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    IdempotencyKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Sanctions", x => x.Id);
                    table.CheckConstraint("CK_Sanctions_CancelReason", "\"Status\" <> 'Cancelled' OR (\"CancelReason\" IS NOT NULL AND \"CancelledAt\" IS NOT NULL)");
                    table.CheckConstraint("CK_Sanctions_Status", "\"Status\" IN ('Active', 'Cancelled')");
                    table.ForeignKey(
                        name: "FK_Sanctions_ApplicationOffers_OfferId",
                        column: x => x.OfferId,
                        principalTable: "ApplicationOffers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Sanctions_CreditApprovals_CreditApprovalId",
                        column: x => x.CreditApprovalId,
                        principalTable: "CreditApprovals",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Sanctions_Loans_LoanId",
                        column: x => x.LoanId,
                        principalTable: "Loans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Sanctions_Sanctions_PreviousSanctionId",
                        column: x => x.PreviousSanctionId,
                        principalTable: "Sanctions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Disbursements",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LoanId = table.Column<int>(type: "integer", nullable: false),
                    SanctionId = table.Column<int>(type: "integer", nullable: false),
                    Type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ReversalOfId = table.Column<int>(type: "integer", nullable: true),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    DisbursementDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    BankAccountNumber = table.Column<string>(type: "character varying(34)", maxLength: 34, nullable: false),
                    Ifsc = table.Column<string>(type: "character varying(11)", maxLength: 11, nullable: false),
                    AccountHolderName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Utr = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    LenderReference = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Mode = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    PreviousLoanStatus = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    CreatedByUserId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    IdempotencyKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Disbursements", x => x.Id);
                    table.CheckConstraint("CK_Disbursements_Amount", "\"Amount\" > 0");
                    table.CheckConstraint("CK_Disbursements_ReversalRef", "\"Type\" <> 'Reversal' OR (\"ReversalOfId\" IS NOT NULL AND \"Reason\" IS NOT NULL)");
                    table.CheckConstraint("CK_Disbursements_Status", "\"Status\" IN ('Completed', 'Reversed')");
                    table.CheckConstraint("CK_Disbursements_Type", "\"Type\" IN ('Disbursement', 'Reversal')");
                    table.ForeignKey(
                        name: "FK_Disbursements_Disbursements_ReversalOfId",
                        column: x => x.ReversalOfId,
                        principalTable: "Disbursements",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Disbursements_Loans_LoanId",
                        column: x => x.LoanId,
                        principalTable: "Loans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_Disbursements_Sanctions_SanctionId",
                        column: x => x.SanctionId,
                        principalTable: "Sanctions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.AddCheckConstraint(
                name: "CK_LoanStatusHistories_FromStatus",
                table: "LoanStatusHistories",
                sql: "\"FromStatus\" IN ('Draft', 'Submitted', 'UnderReview', 'Approved', 'Rejected', 'Disbursed', 'Closed', 'OnHold', 'Decision', 'Acceptance', 'Offer')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_LoanStatusHistories_ToStatus",
                table: "LoanStatusHistories",
                sql: "\"ToStatus\" IN ('Draft', 'Submitted', 'UnderReview', 'Approved', 'Rejected', 'Disbursed', 'Closed', 'OnHold', 'Decision', 'Acceptance', 'Offer')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Loans_PreRejectedStatus",
                table: "Loans",
                sql: "\"PreRejectedStatus\" IS NULL OR \"PreRejectedStatus\" IN ('Draft', 'Submitted', 'UnderReview', 'Approved', 'Rejected', 'Disbursed', 'Closed', 'OnHold', 'Decision', 'Acceptance', 'Offer')");

            migrationBuilder.AddCheckConstraint(
                name: "CK_Loans_Status",
                table: "Loans",
                sql: "\"Status\" IN ('Draft', 'Submitted', 'UnderReview', 'Approved', 'Rejected', 'Disbursed', 'Closed', 'OnHold', 'Decision', 'Acceptance', 'Offer')");

            migrationBuilder.CreateIndex(
                name: "IX_ApplicationOfferRevisions_OfferId_RevisionNo",
                table: "ApplicationOfferRevisions",
                columns: new[] { "OfferId", "RevisionNo" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ApplicationOffers_BankId",
                table: "ApplicationOffers",
                column: "BankId");

            migrationBuilder.CreateIndex(
                name: "IX_ApplicationOffers_CreatedByUserId",
                table: "ApplicationOffers",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_ApplicationOffers_LoanId",
                table: "ApplicationOffers",
                column: "LoanId");

            migrationBuilder.CreateIndex(
                name: "UX_ApplicationOffers_Loan_Bank_Active",
                table: "ApplicationOffers",
                columns: new[] { "LoanId", "BankId" },
                unique: true,
                filter: "\"IsDeleted\" = false AND \"Status\" IN ('Available', 'Final', 'NotSelected')");

            migrationBuilder.CreateIndex(
                name: "UX_ApplicationOffers_Loan_Final",
                table: "ApplicationOffers",
                column: "LoanId",
                unique: true,
                filter: "\"IsDeleted\" = false AND \"Status\" = 'Final'");

            migrationBuilder.CreateIndex(
                name: "IX_CreditApprovals_ApproverUserId",
                table: "CreditApprovals",
                column: "ApproverUserId");

            migrationBuilder.CreateIndex(
                name: "IX_CreditApprovals_IdempotencyKey",
                table: "CreditApprovals",
                column: "IdempotencyKey",
                unique: true,
                filter: "\"IdempotencyKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CreditApprovals_LoanId",
                table: "CreditApprovals",
                column: "LoanId");

            migrationBuilder.CreateIndex(
                name: "IX_CreditApprovals_OfferId",
                table: "CreditApprovals",
                column: "OfferId");

            migrationBuilder.CreateIndex(
                name: "IX_DeviationRules_BankId_DeviationType",
                table: "DeviationRules",
                columns: new[] { "BankId", "DeviationType" });

            migrationBuilder.CreateIndex(
                name: "IX_DeviationRules_RuleKey_Version",
                table: "DeviationRules",
                columns: new[] { "RuleKey", "Version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Disbursements_IdempotencyKey",
                table: "Disbursements",
                column: "IdempotencyKey",
                unique: true,
                filter: "\"IdempotencyKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Disbursements_ReversalOfId",
                table: "Disbursements",
                column: "ReversalOfId");

            migrationBuilder.CreateIndex(
                name: "IX_Disbursements_SanctionId",
                table: "Disbursements",
                column: "SanctionId");

            migrationBuilder.CreateIndex(
                name: "UX_Disbursements_Loan_Completed",
                table: "Disbursements",
                column: "LoanId",
                unique: true,
                filter: "\"Type\" = 'Disbursement' AND \"Status\" = 'Completed'");

            migrationBuilder.CreateIndex(
                name: "IX_OfferDeviations_DecisionIdempotencyKey",
                table: "OfferDeviations",
                column: "DecisionIdempotencyKey",
                unique: true,
                filter: "\"DecisionIdempotencyKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_OfferDeviations_IdempotencyKey",
                table: "OfferDeviations",
                column: "IdempotencyKey",
                unique: true,
                filter: "\"IdempotencyKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_OfferDeviations_LoanId",
                table: "OfferDeviations",
                column: "LoanId");

            migrationBuilder.CreateIndex(
                name: "IX_OfferDeviations_RaisedByUserId",
                table: "OfferDeviations",
                column: "RaisedByUserId");

            migrationBuilder.CreateIndex(
                name: "UX_OfferDeviations_Offer_Raised",
                table: "OfferDeviations",
                column: "OfferId",
                unique: true,
                filter: "\"Status\" = 'Raised'");

            migrationBuilder.CreateIndex(
                name: "IX_Sanctions_CreditApprovalId",
                table: "Sanctions",
                column: "CreditApprovalId");

            migrationBuilder.CreateIndex(
                name: "IX_Sanctions_IdempotencyKey",
                table: "Sanctions",
                column: "IdempotencyKey",
                unique: true,
                filter: "\"IdempotencyKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Sanctions_OfferId",
                table: "Sanctions",
                column: "OfferId");

            migrationBuilder.CreateIndex(
                name: "IX_Sanctions_PreviousSanctionId",
                table: "Sanctions",
                column: "PreviousSanctionId");

            migrationBuilder.CreateIndex(
                name: "IX_Sanctions_SanctionNumber",
                table: "Sanctions",
                column: "SanctionNumber",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "UX_Sanctions_Loan_Active",
                table: "Sanctions",
                column: "LoanId",
                unique: true,
                filter: "\"Status\" = 'Active'");

            // ── PostgreSQL-level business guards (backstop for the service) ──────
            if (migrationBuilder.ActiveProvider == "Npgsql.EntityFrameworkCore.PostgreSQL")
            {
                // Max 3 live offers (Available / Final / NotSelected) per application. The parent loan row is locked
                // so two concurrent inserts cannot both pass the count.
                migrationBuilder.Sql(@"
CREATE OR REPLACE FUNCTION loanms_offer_max_active() RETURNS trigger AS $$
DECLARE n int;
BEGIN
  IF NEW.""IsDeleted"" = false AND NEW.""Status"" IN ('Available','Final','NotSelected') THEN
    PERFORM 1 FROM ""Loans"" WHERE ""Id"" = NEW.""LoanId"" FOR UPDATE;
    SELECT count(*) INTO n FROM ""ApplicationOffers""
     WHERE ""LoanId"" = NEW.""LoanId"" AND ""Id"" <> NEW.""Id"" AND ""IsDeleted"" = false
       AND ""Status"" IN ('Available','Final','NotSelected');
    IF n >= 3 THEN
      RAISE EXCEPTION 'An application can hold at most 3 active lender offers.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.""LoanId"" <> OLD.""LoanId"" OR NEW.""BankId"" <> OLD.""BankId"" THEN
      RAISE EXCEPTION 'An offer''s application and lender cannot change.' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_offer_max_active BEFORE INSERT OR UPDATE ON ""ApplicationOffers""
  FOR EACH ROW EXECUTE FUNCTION loanms_offer_max_active();");

                // Append-only / immutable records.
                migrationBuilder.Sql(@"
CREATE OR REPLACE FUNCTION loanms_immutable_row() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (% refused).', TG_TABLE_NAME, TG_OP USING ERRCODE = 'P0001';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_offer_revision_immutable BEFORE UPDATE OR DELETE ON ""ApplicationOfferRevisions""
  FOR EACH ROW EXECUTE FUNCTION loanms_immutable_row();
CREATE TRIGGER trg_offer_no_delete BEFORE DELETE ON ""ApplicationOffers""
  FOR EACH ROW EXECUTE FUNCTION loanms_immutable_row();
CREATE TRIGGER trg_credit_approval_no_delete BEFORE DELETE ON ""CreditApprovals""
  FOR EACH ROW EXECUTE FUNCTION loanms_immutable_row();
CREATE TRIGGER trg_sanction_no_delete BEFORE DELETE ON ""Sanctions""
  FOR EACH ROW EXECUTE FUNCTION loanms_immutable_row();
CREATE TRIGGER trg_disbursement_no_delete BEFORE DELETE ON ""Disbursements""
  FOR EACH ROW EXECUTE FUNCTION loanms_immutable_row();
CREATE TRIGGER trg_deviation_rule_no_delete BEFORE DELETE ON ""DeviationRules""
  FOR EACH ROW EXECUTE FUNCTION loanms_immutable_row();
CREATE TRIGGER trg_offer_deviation_no_delete BEFORE DELETE ON ""OfferDeviations""
  FOR EACH ROW EXECUTE FUNCTION loanms_immutable_row();");

                // Credit approval: only IsCurrent may change, and only true → false.
                migrationBuilder.Sql(@"
CREATE OR REPLACE FUNCTION loanms_credit_approval_guard() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'IsCurrent') IS DISTINCT FROM (to_jsonb(OLD) - 'IsCurrent')
     OR (OLD.""IsCurrent"" = false AND NEW.""IsCurrent"" = true) THEN
    RAISE EXCEPTION 'Credit approvals are immutable (only invalidation is allowed).' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_credit_approval_guard BEFORE UPDATE ON ""CreditApprovals""
  FOR EACH ROW EXECUTE FUNCTION loanms_credit_approval_guard();");

                // Sanction snapshot: only the cancellation fields may change, once.
                migrationBuilder.Sql(@"
CREATE OR REPLACE FUNCTION loanms_sanction_guard() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['Status','CancellationType','CancelReason','CancelledByUserId','CancelledAt'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['Status','CancellationType','CancelReason','CancelledByUserId','CancelledAt']) THEN
    RAISE EXCEPTION 'Sanction terms are immutable — cancel with type Amendment and re-sanction.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.""Status"" <> 'Active' THEN
    RAISE EXCEPTION 'A % sanction cannot be changed.', OLD.""Status"" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_sanction_guard BEFORE UPDATE ON ""Sanctions""
  FOR EACH ROW EXECUTE FUNCTION loanms_sanction_guard();");

                // Disbursement money record: only Completed → Reversed.
                migrationBuilder.Sql(@"
CREATE OR REPLACE FUNCTION loanms_disbursement_guard() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'Status') IS DISTINCT FROM (to_jsonb(OLD) - 'Status')
     OR NOT (OLD.""Status"" = 'Completed' AND NEW.""Status"" IN ('Completed','Reversed')) THEN
    RAISE EXCEPTION 'Disbursement records are immutable — post a reversal instead.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_disbursement_guard BEFORE UPDATE ON ""Disbursements""
  FOR EACH ROW EXECUTE FUNCTION loanms_disbursement_guard();");

                // Rule versions: content is immutable; only activation / retirement fields change.
                migrationBuilder.Sql(@"
CREATE OR REPLACE FUNCTION loanms_rule_version_guard() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['IsActive','SupersededAt','DeactivatedAt','DeactivatedByUserId'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['IsActive','SupersededAt','DeactivatedAt','DeactivatedByUserId']) THEN
    RAISE EXCEPTION 'A deviation rule version is immutable — create a new version.' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.""SupersededAt"" IS NOT NULL AND NEW.""IsActive"" = true THEN
    RAISE EXCEPTION 'A superseded rule version cannot be re-activated.' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_rule_version_guard BEFORE UPDATE ON ""DeviationRules""
  FOR EACH ROW EXECUTE FUNCTION loanms_rule_version_guard();");

                // A decided deviation request is final (only its task link may be set).
                migrationBuilder.Sql(@"
CREATE OR REPLACE FUNCTION loanms_offer_deviation_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.""Status"" <> 'Raised' AND (to_jsonb(NEW) - 'TaskId') IS DISTINCT FROM (to_jsonb(OLD) - 'TaskId') THEN
    RAISE EXCEPTION 'A % deviation request is final — raise a new request on revised terms.', OLD.""Status"" USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_offer_deviation_guard BEFORE UPDATE ON ""OfferDeviations""
  FOR EACH ROW EXECUTE FUNCTION loanms_offer_deviation_guard();");
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

            if (migrationBuilder.ActiveProvider == "Npgsql.EntityFrameworkCore.PostgreSQL")
            {
                migrationBuilder.Sql(@"
DROP TRIGGER IF EXISTS trg_offer_max_active ON ""ApplicationOffers"";
DROP TRIGGER IF EXISTS trg_offer_no_delete ON ""ApplicationOffers"";
DROP TRIGGER IF EXISTS trg_offer_revision_immutable ON ""ApplicationOfferRevisions"";
DROP TRIGGER IF EXISTS trg_credit_approval_no_delete ON ""CreditApprovals"";
DROP TRIGGER IF EXISTS trg_credit_approval_guard ON ""CreditApprovals"";
DROP TRIGGER IF EXISTS trg_sanction_no_delete ON ""Sanctions"";
DROP TRIGGER IF EXISTS trg_sanction_guard ON ""Sanctions"";
DROP TRIGGER IF EXISTS trg_disbursement_no_delete ON ""Disbursements"";
DROP TRIGGER IF EXISTS trg_disbursement_guard ON ""Disbursements"";
DROP TRIGGER IF EXISTS trg_deviation_rule_no_delete ON ""DeviationRules"";
DROP TRIGGER IF EXISTS trg_rule_version_guard ON ""DeviationRules"";
DROP TRIGGER IF EXISTS trg_offer_deviation_no_delete ON ""OfferDeviations"";
DROP TRIGGER IF EXISTS trg_offer_deviation_guard ON ""OfferDeviations"";
DROP FUNCTION IF EXISTS loanms_offer_max_active();
DROP FUNCTION IF EXISTS loanms_immutable_row();
DROP FUNCTION IF EXISTS loanms_credit_approval_guard();
DROP FUNCTION IF EXISTS loanms_sanction_guard();
DROP FUNCTION IF EXISTS loanms_disbursement_guard();
DROP FUNCTION IF EXISTS loanms_rule_version_guard();
DROP FUNCTION IF EXISTS loanms_offer_deviation_guard();");
            }
            migrationBuilder.DropTable(
                name: "ApplicationOfferRevisions");

            migrationBuilder.DropTable(
                name: "DeviationRules");

            migrationBuilder.DropTable(
                name: "Disbursements");

            migrationBuilder.DropTable(
                name: "OfferDeviations");

            migrationBuilder.DropTable(
                name: "Sanctions");

            migrationBuilder.DropTable(
                name: "CreditApprovals");

            migrationBuilder.DropTable(
                name: "ApplicationOffers");

            migrationBuilder.DropCheckConstraint(
                name: "CK_LoanStatusHistories_FromStatus",
                table: "LoanStatusHistories");

            migrationBuilder.DropCheckConstraint(
                name: "CK_LoanStatusHistories_ToStatus",
                table: "LoanStatusHistories");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Loans_PreRejectedStatus",
                table: "Loans");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Loans_Status",
                table: "Loans");
        }
    }
}
