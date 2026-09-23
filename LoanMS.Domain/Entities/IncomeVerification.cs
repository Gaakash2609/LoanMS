using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Income Verification (authoritative header) ────────────────────────────────
// The backend's single source of truth for one applicant's salary/income
// verification on a loan. Before this, "verification" lived entirely client-side
// (_crossVerifySalary reading window._lastPerfiosReport) and the only backend
// signal was the client-settable Loan.IncomeChecked bool — which the browser
// could flip to true with no evidence (Phase 1 vulns S1–S3). This record makes
// the RESULT authoritative and reproducible: the engine (Phase 4) writes it,
// APIs (Phase 5) read it, and downstream (Phase 7) trusts it — never the client.
//
// Phase 2 = data foundation only. This entity + its Months + the linked
// SalarySlipExtraction rows are created now; they are POPULATED by later phases.
public class IncomeVerification : BaseEntity
{
    public int LoanId { get; set; }

    // ── §6 applicant isolation ────────────────────────────────────────────────
    /// <summary>Whose income this verification is for (primary vs a co-applicant).</summary>
    public ApplicantRole ApplicantRole { get; set; } = ApplicantRole.Applicant;
    /// <summary>Stable identifier of the applicant within the loan's wizard data
    /// (e.g. "primary" or a co-applicant index/name key). Lets a verification be
    /// tied to a specific person even though co-applicants are not yet a
    /// first-class entity. Never rely on browser-selected identity alone.</summary>
    public string? ApplicantKey { get; set; }

    // ── State (stored as string via HasConversion) ─────────────────────────────
    public IncomeVerificationState State { get; set; } = IncomeVerificationState.Pending;

    // ── §26(b) fixed reference date — persisted so a re-run does NOT drift ──────
    /// <summary>The canonical business date the required-month window is derived
    /// from (submit date preferred, else loan CreatedAt). Persisted so re-running
    /// on a later system date keeps the same required months.</summary>
    public DateTime RequiredMonthsReferenceDate { get; set; }
    /// <summary>The resolved required months (oldest→newest) snapshotted at run
    /// time, as JSON [{y,m,label}], mirroring Vanilla _incRequiredMonths output.</summary>
    public string? RequiredMonthsJson { get; set; }

    // ── The five income concepts kept explicitly separate (§5) ──────────────────
    /// <summary>Declared income snapshot at run time (Customer.MonthlyIncome).</summary>
    public decimal? DeclaredIncome { get; set; }
    /// <summary>Average payslip-extracted net (from immutable originals).</summary>
    public decimal? ExtractedIncome { get; set; }
    /// <summary>Bank-verified / final trusted income — ONLY set on AutoVerified or
    /// ManualReviewCompleted(approved). Null otherwise; never derived from the
    /// client. This is the value downstream Eligibility/FOIR/CAM may trust.</summary>
    public decimal? VerifiedIncome { get; set; }

    /// <summary>Structured reason codes + human detail as JSON
    /// [{code,detail,monthLabel?}] — only codes whose rule is implemented.</summary>
    public string? ReasonCodesJson { get; set; }

    // ── §26(k) reproducibility / snapshot ───────────────────────────────────────
    /// <summary>The Perfios report this decision was made against.</summary>
    public int? PerfiosReportId { get; set; }
    /// <summary>Hash of the exact source report data (PerfiosReport.ReportDataJson)
    /// at decision time, so a later re-import cannot silently change what a past
    /// verification rested on.</summary>
    public string? SourceReportHash { get; set; }

    // ── §26(j) idempotency ──────────────────────────────────────────────────────
    /// <summary>Client-supplied idempotency key for the verify request, so a
    /// double-click / retry does not create duplicate verification records.</summary>
    public string? IdempotencyKey { get; set; }

    // ── Execution + manual-review audit stamps ──────────────────────────────────
    public int RunByUserId { get; set; }
    public DateTime RunAt { get; set; }
    public int? ReviewedByUserId { get; set; }
    public DateTime? ReviewedAt { get; set; }
    /// <summary>"Approved" / "Rejected" — the manual reviewer's decision.</summary>
    public string? ReviewDecision { get; set; }
    public string? ReviewReason { get; set; }

    // Navigation
    public Loan Loan { get; set; } = null!;
    public ICollection<IncomeVerificationMonth> Months { get; set; } = new List<IncomeVerificationMonth>();
}
