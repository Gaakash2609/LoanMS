namespace LoanMS.Domain.Entities;

// ── Lender Email Workflow — thread log ────────────────────────────────────
/// <summary>
/// One entry (sent or received) in the lender-RM email conversation for a
/// loan application, post-underwriting (offer/approved/acceptance/disbursed
/// stages). Was frontend-only (lender-email-workflow.js, localStorage key
/// 'efin_lew_email_threads_v1') — the entire conversation history, including
/// Claude-parsed lender replies used to gate approval stages, was invisible
/// to anyone but the browser that sent/received it, and was not a real audit
/// trail. Append-only by design (mirrors AssignmentAuditLog): entries are
/// never edited after creation.
/// </summary>
public class LenderEmailThreadEntry : BaseEntity
{
    /// <summary>FK to Loan.Id (the numeric DB id, i.e. the frontend's app._apiId).</summary>
    public int LoanApplicationId { get; set; }
    public Loan? LoanApplication { get; set; }

    /// <summary>"sent" | "received".</summary>
    public string Direction { get; set; } = string.Empty;
    /// <summary>Pipeline stage this entry relates to (offer/approved/acceptance/disbursed).</summary>
    public string? Stage { get; set; }
    public string? RmName { get; set; }
    public string? RmEmail { get; set; }
    public string? Subject { get; set; }
    public string? BodyText { get; set; }
    /// <summary>How this entry was created — e.g. "auto", "manual", "ai-parsed".</summary>
    public string? Source { get; set; }
    /// <summary>Claude-parsed structured data from a lender reply, stored as raw JSON, if any.</summary>
    public string? ParsedDataJson { get; set; }
}
