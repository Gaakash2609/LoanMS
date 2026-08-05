namespace LoanMS.Domain.Entities;

// ── AI Agent (Akshiv) — run history ───────────────────────────────────────
/// <summary>
/// One auto-processing run of the "Akshiv" AI agent against a loan
/// application (wip → login → underwriting → ... pipeline). Was
/// frontend-only (ai-agent.js, localStorage key 'efin_ai_agent_v3') — run
/// history/audit trail for an automated system that edits applications was
/// invisible to anyone but the browser that triggered it. Append-only by
/// design (mirrors AssignmentAuditLog), though Status/FinishedAt/Error are
/// updated once as the run completes.
/// </summary>
public class AiAgentRun : BaseEntity
{
    /// <summary>FK to Loan.Id (the numeric DB id / app._apiId).</summary>
    public int LoanApplicationId { get; set; }
    public Loan? LoanApplication { get; set; }

    public string RunId { get; set; } = string.Empty;
    public DateTime StartedAt { get; set; }
    public DateTime? FinishedAt { get; set; }
    /// <summary>running | success | failed.</summary>
    public string Status { get; set; } = "running";
    public string? Error { get; set; }
    /// <summary>Ordered list of step descriptions, stored as raw JSON.</summary>
    public string? StepsJson { get; set; }
}
