using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CreateLoanObligationRequestDto
{
    [Required]
    public int LoanApplicationId { get; set; }

    [Required]
    public string LoanType { get; set; } = string.Empty;

    public decimal SanctionAmount { get; set; }
    public string? FinancerName { get; set; }
    public decimal LoanEmi { get; set; }
    public decimal AmountOutstanding { get; set; }
    public DateTime? LoanClosureDate { get; set; }
    public string? LoanAccountNumber { get; set; }
    public bool SelectBT { get; set; }

    // ── Credit-review extension (all optional — legacy callers omit them and get
    // the safe defaults Applicant / Manual / Unverified / active) ────────────────
    /// <summary>"Applicant" | "CoApplicant" — defaults to Applicant when omitted.</summary>
    public string? ApplicantRole { get; set; }
    public string? ApplicantKey { get; set; }
    public bool IsClosed { get; set; }
    public decimal? InterestRate { get; set; }
    public int? TenureMonths { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? MaturityDate { get; set; }
    public string? Notes { get; set; }
}
