using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Income Verification — per required month (§13) ────────────────────────────
// The spec forbids storing only a final boolean. Each required salary month gets
// its own auditable row: which slip, the effective salary reviewed, the matched
// bank transaction (id/date/amount), the window it was matched in, the outcome
// and reason. Written by Phase 4's engine; defined here in Phase 2.
public class IncomeVerificationMonth : BaseEntity
{
    public int IncomeVerificationId { get; set; }

    // Required month (mirrors Vanilla _incRequiredMonths: month is 1-based here).
    public int Year { get; set; }
    public int Month { get; set; }
    /// <summary>e.g. "Apr 2026".</summary>
    public string MonthLabel { get; set; } = string.Empty;

    // ── Salary side ─────────────────────────────────────────────────────────────
    /// <summary>The slip that supplied this month's salary, if found.</summary>
    public int? SalarySlipExtractionId { get; set; }
    /// <summary>Immutable extracted net for this month (copied from the slip).</summary>
    public decimal? OriginalExtractedSalary { get; set; }
    /// <summary>Salary actually used for the match — the user override when one
    /// exists (which forces manual review), else the original.</summary>
    public decimal? EffectiveSalary { get; set; }

    // ── Match outcome (stored as string) ────────────────────────────────────────
    /// <summary>Matched | AmountMismatch | NoCreditInWindow | MissingSlip |
    /// OutsideWindow | DuplicateSlip | Pending.</summary>
    public string MatchStatus { get; set; } = "Pending";
    /// <summary>Reason code (IncomeVerificationReason) when not a clean match.</summary>
    public string? ReasonCode { get; set; }

    // ── Bank side (the credit that satisfied this month, if any) ────────────────
    public string? MatchedTransactionRef { get; set; }
    public DateTime? MatchedTransactionDate { get; set; }
    public decimal? MatchedAmount { get; set; }

    // ── The window this month was evaluated in (20th → next 15th) ───────────────
    public DateTime WindowStart { get; set; }
    public DateTime WindowEnd { get; set; }

    /// <summary>How the match was made (e.g. "PerfiosSalary" / "NEFT-RTGS").</summary>
    public string? VerificationMethod { get; set; }
    /// <summary>Bank account / report source the credit came from (§6/§8 traceability).</summary>
    public string? BankAccountRef { get; set; }

    // Navigation
    public IncomeVerification IncomeVerification { get; set; } = null!;
}
