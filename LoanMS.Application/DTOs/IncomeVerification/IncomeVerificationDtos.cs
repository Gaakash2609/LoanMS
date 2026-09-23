using LoanMS.Domain.Enums;

namespace LoanMS.Application.DTOs.IncomeVerification;

// ── Income Verification API DTOs (Phase 5) ────────────────────────────────────

public class RunIncomeVerificationRequestDto
{
    public ApplicantRole ApplicantRole { get; set; } = ApplicantRole.Applicant;
    public string? ApplicantKey { get; set; }
    /// <summary>Optional idempotency key — a retry/double-click with the same key
    /// returns the existing verification instead of creating a duplicate.</summary>
    public string? IdempotencyKey { get; set; }
}

public class ManualReviewRequestDto
{
    /// <summary>"Approved" | "Rejected".</summary>
    public string Decision { get; set; } = string.Empty;
    /// <summary>Mandatory reviewer reason.</summary>
    public string Reason { get; set; } = string.Empty;
}

public class SalaryOverrideRequestDto
{
    public decimal UserEditedSalary { get; set; }
    /// <summary>Mandatory override reason (§4).</summary>
    public string Reason { get; set; } = string.Empty;
}

public class IncomeVerificationReasonDto
{
    public string Code { get; set; } = string.Empty;
    public string? MonthLabel { get; set; }
    public string Detail { get; set; } = string.Empty;
}

public class IncomeVerificationMonthDto
{
    public int Year { get; set; }
    public int Month { get; set; }
    public string MonthLabel { get; set; } = string.Empty;
    public int? SalarySlipExtractionId { get; set; }
    public decimal? OriginalExtractedSalary { get; set; }
    public decimal? EffectiveSalary { get; set; }
    public string MatchStatus { get; set; } = string.Empty;
    public string? ReasonCode { get; set; }
    public string? MatchedTransactionRef { get; set; }
    public DateTime? MatchedTransactionDate { get; set; }
    public decimal? MatchedAmount { get; set; }
    public DateTime WindowStart { get; set; }
    public DateTime WindowEnd { get; set; }
    public string? VerificationMethod { get; set; }
    public string? BankAccountRef { get; set; }
}

public class IncomeVerificationResultDto
{
    public int Id { get; set; }
    public int LoanId { get; set; }
    public string ApplicantRole { get; set; } = string.Empty;
    public string? ApplicantKey { get; set; }
    public string State { get; set; } = string.Empty;
    public DateTime RequiredMonthsReferenceDate { get; set; }
    public decimal? DeclaredIncome { get; set; }
    public decimal? ExtractedIncome { get; set; }
    public decimal? VerifiedIncome { get; set; }
    public int? PerfiosReportId { get; set; }
    public string? SourceReportHash { get; set; }
    public int RunByUserId { get; set; }
    public DateTime RunAt { get; set; }
    public int? ReviewedByUserId { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public string? ReviewDecision { get; set; }
    public string? ReviewReason { get; set; }
    public List<IncomeVerificationReasonDto> Reasons { get; set; } = new();
    public List<IncomeVerificationMonthDto> Months { get; set; } = new();
}
