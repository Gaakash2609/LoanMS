namespace LoanMS.Domain.Entities;

// ── Perfios Report ────────────────────────────────────────────────────────────
// Bank-statement verification result (salary/transaction analysis run
// entirely client-side by the Perfios module — see perfios-renderer.js's
// pfv9ConfirmAttachment). Was never persisted anywhere before this — the
// result lived only in a JS variable (window._perfiosBankDoc) and vanished
// on refresh or when viewed from a different device/session. This stores
// just the summary fields the UI actually displays/relies on, not every
// individual parsed transaction row (the source PDF itself is already
// separately saved through the normal document-upload flow).
public class PerfiosReport : BaseEntity
{
    public int LoanId { get; set; }
    public string? FileName { get; set; }
    /// <summary>Average Bank Balance — kept as a string since the frontend already formats/labels this (e.g. currency-formatted), not a raw number.</summary>
    public string? AverageBankBalance { get; set; }
    public string? Span { get; set; }
    public int? TotalTransactions { get; set; }
    public bool HasSalary { get; set; }
    public bool IsValid { get; set; }
    public string? FirstTransactionDate { get; set; }
    public string? LastTransactionDate { get; set; }
    public bool ManualReviewRequired { get; set; }
    public int? StaleDays { get; set; }
    public DateTime VerifiedAt { get; set; }

    public Loan Loan { get; set; } = null!;
}
