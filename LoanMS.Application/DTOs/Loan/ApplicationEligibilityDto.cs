using LoanMS.Domain.Enums;

namespace LoanMS.Application.DTOs;

/// <summary>
/// Result of the central "may this customer start (or reactivate) an
/// application?" guard — LoanService.EvaluateApplicationEligibility. Code is
/// one of ApiErrorCodes (null when Allowed).
/// </summary>
public class ApplicationEligibilityDto
{
    public bool Allowed { get; set; }
    public string? Code { get; set; }
    public string? Message { get; set; }
    public int? BlockingLoanId { get; set; }
    public string? BlockingLoanNumber { get; set; }
    public string? BlockingStatus { get; set; }
    public int? BlockingLoanCreatedByUserId { get; set; }
    /// <summary>Latest rejection time (UTC) the cooldown was computed from.</summary>
    public DateTime? LatestRejectedAtUtc { get; set; }
    /// <summary>First instant (UTC) a new application is allowed: LatestRejectedAt + 45 days.</summary>
    public DateTime? ReapplyAfterUtc { get; set; }

    public static ApplicationEligibilityDto Ok() => new() { Allowed = true };
}

/// <summary>One of a customer's applications as the eligibility guard sees it
/// (read with soft-deleted rows included, so deleting a rejected application
/// can never erase its cooldown).</summary>
public class LoanEligibilityRow
{
    public int Id { get; set; }
    public string LoanNumber { get; set; } = string.Empty;
    public LoanStatus Status { get; set; }
    public bool IsDeleted { get; set; }
    public bool IsArchived { get; set; }
    public int CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime? RejectedAt { get; set; }
    /// <summary>Latest LoanStatusHistory row that moved this loan INTO Rejected
    /// (FromStatus != Rejected) — the exact, reliable fallback when RejectedAt is
    /// missing on legacy rows, and a correction when a later re-rejection path
    /// did not refresh RejectedAt.</summary>
    public DateTime? LastRejectionTransitionAt { get; set; }
}

public class ArchiveLoanRequestDto
{
    public string? Reason { get; set; }
}
