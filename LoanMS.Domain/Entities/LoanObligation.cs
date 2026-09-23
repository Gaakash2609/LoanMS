using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Loan Obligation (Running Loan / Bank Line) ──────────────────────────────
// Mirrors running_loan_bank_line.py — the per-application FOIR obligation
// rows shown on the loan detail "Obligations" tab. Previously frontend-only
// (efin-app.js `var OBLIGATIONS = {}`), persisted only to the browser's
// localStorage — data added on one browser/device never showed up on
// another. This entity is what makes it real, database-backed loan data.
//
// ── Credit-review extension (additive) ──────────────────────────────────────
// The legacy fields above the "Credit-review" divider are unchanged. Everything
// below is a nullable / safe-defaulted addition that turns a flat CRUD row into a
// proper credit-underwriting obligation: WHOSE liability it is (§6 applicant
// isolation, reusing the ApplicantRole/ApplicantKey pattern from
// IncomeVerification/SalarySlipExtraction), WHERE it came from (Source), whether a
// reviewer trusts it (VerificationStatus), whether it is still a live burden
// (IsClosed), and — for detected rows — the ORIGINAL machine-detected figures kept
// immutable beside any human override (the same immutable-original + separate-
// override discipline SalarySlipExtraction uses), so a manual edit can never
// silently erase what the evidence actually showed.
public class LoanObligation : BaseEntity
{
    public int LoanApplicationId { get; set; }
    public string LoanType { get; set; } = string.Empty;
    public decimal SanctionAmount { get; set; }
    public string? FinancerName { get; set; }
    public decimal LoanEmi { get; set; }
    public decimal AmountOutstanding { get; set; }
    public DateTime? LoanClosureDate { get; set; }
    /// <summary>Loan account number (frontend: obl-accno / loan_acc_no).</summary>
    public string? LoanAccountNumber { get; set; }
    /// <summary>Marked for Balance Transfer (frontend: select_bt / toggleBT).</summary>
    public bool SelectBT { get; set; }

    // ── Credit-review: applicant isolation (§6) ─────────────────────────────────
    /// <summary>Whose liability this is — the primary applicant or a co-applicant.
    /// An applicant's obligations are NEVER folded into a co-applicant's FOIR and
    /// vice-versa; the service groups strictly on (ApplicantRole, ApplicantKey).</summary>
    public ApplicantRole ApplicantRole { get; set; } = ApplicantRole.Applicant;
    /// <summary>Stable identifier of the applicant within the loan's wizard data
    /// (e.g. "primary" or a co-applicant key), mirroring IncomeVerification.</summary>
    public string? ApplicantKey { get; set; }

    // ── Credit-review: provenance + lifecycle ───────────────────────────────────
    public ObligationSource Source { get; set; } = ObligationSource.Manual;
    public ObligationVerificationStatus VerificationStatus { get; set; } = ObligationVerificationStatus.Unverified;
    /// <summary>True once this liability is settled/closed — a closed loan is NOT
    /// counted as a live monthly obligation in FOIR, but the row is retained (never
    /// deleted) as historical financial information.</summary>
    public bool IsClosed { get; set; }

    // ── Credit-review: fuller loan terms (all optional — may be genuinely unknown,
    // especially for a detected row where evidence does not reveal them) ─────────
    public decimal? InterestRate { get; set; }
    public int? TenureMonths { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? MaturityDate { get; set; }
    public string? Notes { get; set; }

    // ── Credit-review: immutable original detected values (§ SalarySlipExtraction
    // pattern) — written once when a row is detected, NEVER overwritten by an edit ─
    /// <summary>The EMI exactly as detected from evidence (recurring debit amount).
    /// Kept immutable so a later manual override of <see cref="LoanEmi"/> can be
    /// compared back against what the bank statement actually showed.</summary>
    public decimal? DetectedEmi { get; set; }
    public string? DetectedFinancerName { get; set; }
    public string? DetectedAccountNumber { get; set; }
    /// <summary>The Perfios report this row was detected from (traceability).</summary>
    public int? SourcePerfiosReportId { get; set; }
    /// <summary>Deterministic signature of the detected recurring-debit group
    /// (normalized narration + rounded amount). Lets a re-run of detection recognise
    /// an already-imported obligation instead of creating a duplicate.</summary>
    public string? DetectionSignature { get; set; }
    /// <summary>Compact JSON evidence for a detected row — the matched recurring
    /// debits [{date,amount,desc}] and occurrence count — so a reviewer can see WHY
    /// it was flagged. Null for manual rows.</summary>
    public string? DetectionEvidenceJson { get; set; }

    // ── Credit-review: manual override audit (never destroys the original) ───────
    /// <summary>True when a user has hand-edited a detected/imported row's figures.
    /// Forces the row back to ReviewRequired so an edit can never masquerade as a
    /// verified machine reading.</summary>
    public bool IsManualOverride { get; set; }
    public string? OverrideReason { get; set; }
    public int? OverriddenByUserId { get; set; }
    public DateTime? OverriddenAt { get; set; }

    // ── Credit-review: verification audit stamps ────────────────────────────────
    public int? VerifiedByUserId { get; set; }
    public DateTime? VerifiedAt { get; set; }
    public string? VerificationNote { get; set; }
    /// <summary>Who created the row (audit). Existing rows keep null.</summary>
    public int? CreatedByUserId { get; set; }

    // Navigation
    public Loan LoanApplication { get; set; } = null!;
}
