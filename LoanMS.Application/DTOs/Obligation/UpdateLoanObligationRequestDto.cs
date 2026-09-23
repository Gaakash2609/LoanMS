using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class UpdateLoanObligationRequestDto
{
    [Required]
    public string LoanType { get; set; } = string.Empty;

    public decimal SanctionAmount { get; set; }
    public string? FinancerName { get; set; }
    public decimal LoanEmi { get; set; }
    public decimal AmountOutstanding { get; set; }
    public DateTime? LoanClosureDate { get; set; }
    public string? LoanAccountNumber { get; set; }
    public bool SelectBT { get; set; }

    // ── Credit-review extension (optional) ──────────────────────────────────────
    public string? ApplicantRole { get; set; }
    public string? ApplicantKey { get; set; }
    public bool IsClosed { get; set; }
    public decimal? InterestRate { get; set; }
    public int? TenureMonths { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? MaturityDate { get; set; }
    public string? Notes { get; set; }

    /// <summary>Required by the service ONLY when this update edits the figures of a
    /// detected (non-Manual) obligation — the edit is recorded as a manual override
    /// (with this reason) instead of silently overwriting the machine reading.</summary>
    public string? OverrideReason { get; set; }
}
