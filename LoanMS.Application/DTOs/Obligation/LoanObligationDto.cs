namespace LoanMS.Application.DTOs;

public class LoanObligationDto
{
    public int Id { get; set; }
    public int LoanApplicationId { get; set; }
    public string LoanType { get; set; } = string.Empty;
    public decimal SanctionAmount { get; set; }
    public string? FinancerName { get; set; }
    public decimal LoanEmi { get; set; }
    public decimal AmountOutstanding { get; set; }
    public DateTime? LoanClosureDate { get; set; }
    public string? LoanAccountNumber { get; set; }
    public bool SelectBT { get; set; }

    // ── Credit-review extension ─────────────────────────────────────────────────
    /// <summary>"Applicant" | "CoApplicant".</summary>
    public string ApplicantRole { get; set; } = "Applicant";
    public string? ApplicantKey { get; set; }
    /// <summary>"Manual" | "BankStatement" | "Bureau" | "Document".</summary>
    public string Source { get; set; } = "Manual";
    /// <summary>"Unverified" | "ReviewRequired" | "Verified" | "Rejected".</summary>
    public string VerificationStatus { get; set; } = "Unverified";
    public bool IsClosed { get; set; }

    public decimal? InterestRate { get; set; }
    public int? TenureMonths { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? MaturityDate { get; set; }
    public string? Notes { get; set; }

    // Immutable detected originals (null for manual rows).
    public decimal? DetectedEmi { get; set; }
    public string? DetectedFinancerName { get; set; }
    public string? DetectedAccountNumber { get; set; }
    public int? SourcePerfiosReportId { get; set; }
    public string? DetectionEvidenceJson { get; set; }

    // Override / verification audit.
    public bool IsManualOverride { get; set; }
    public string? OverrideReason { get; set; }
    public int? VerifiedByUserId { get; set; }
    public DateTime? VerifiedAt { get; set; }
    public string? VerificationNote { get; set; }

    /// <summary>Server-computed convenience flag: does this obligation's EMI count
    /// as a live monthly burden in FOIR (i.e. not closed and not rejected)?</summary>
    public bool CountsTowardFoir { get; set; }
    /// <summary>Server-computed: the detected original and the current value disagree
    /// beyond tolerance — a reconciliation mismatch a reviewer should look at.</summary>
    public bool HasReconciliationMismatch { get; set; }

    public DateTime CreatedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
}
