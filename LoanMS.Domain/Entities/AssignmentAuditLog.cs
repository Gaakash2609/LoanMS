namespace LoanMS.Domain.Entities;

// ── Assignment Audit Log (Loan Application auto-assignment trail) ──────────────
/// <summary>
/// Immutable, insert-only audit trail of every Sales Team / Login User
/// assignment decision made for a loan application — both AUTOMATIC ones from
/// the auto-assignment engine (computeLoginUserAssignment /
/// commitAssignmentDecision in efin-app.js) and MANUAL reassignments
/// (updateLoginUser). Previously this was ASSIGNMENT_AUDIT_LOG — a
/// frontend-only in-memory array (`let ASSIGNMENT_AUDIT_LOG = []`) persisted
/// only to the browser's localStorage, so history recorded on one
/// device/browser never showed up on another. This entity is what makes it
/// real, database-backed data.
///
/// Field layout intentionally mirrors the exact shape of the entry object
/// already pushed in efin-app.js (commitAssignmentDecision / updateLoginUser)
/// rather than inventing a new shape, so nothing about the audit record is
/// lost in translation:
///   id, appId, location, loanType, salesPerson, salesTeam, candidates,
///   assignedUser, method, tieBreak, previousUser, decidedBy, timestamp.
///
/// Deliberately NOT a BaseEntity (no soft-delete, no update) — same
/// "no PUT/DELETE, insert-only" convention as AssignmentLog — this is a
/// write-once audit record, not editable master data.
/// </summary>
public class AssignmentAuditLog
{
    public int Id { get; set; }

    /// <summary>Numeric backend Loan id (FK), when known. Nullable because the
    /// AUTOMATIC decision is committed at wizard-submit time — before the loan
    /// itself has necessarily round-tripped to the API and received a real id
    /// — same "sync when the id is known" situation LoanObligation already
    /// handles for app._apiId elsewhere in this codebase.</summary>
    public int? LoanApplicationId { get; set; }

    /// <summary>Frontend application id (e.g. "EFIN000123", or the temporary
    /// "APP-XXXXXX" id used before a loan number is issued). Always populated
    /// — this is the reliable cross-device join key even when
    /// <see cref="LoanApplicationId"/> isn't resolvable yet (frontend: entry.appId).</summary>
    public string LoanFrontendId { get; set; } = string.Empty;

    /// <summary>Frontend: entry.location.</summary>
    public string? Location { get; set; }
    /// <summary>Frontend: entry.loanType.</summary>
    public string? LoanType { get; set; }
    /// <summary>Frontend: entry.salesPerson.</summary>
    public string? SalesPerson { get; set; }
    /// <summary>Frontend: entry.salesTeam.</summary>
    public string? SalesTeam { get; set; }

    /// <summary>Resolved backend User id of the assigned Login User, when
    /// resolvable from twUsers[].name → twUsers[]._apiId at push time. Null if
    /// unassigned, or if that user hasn't synced to the backend yet.</summary>
    public int? AssignedToUserId { get; set; }
    /// <summary>Frontend: entry.assignedUser (display name — always the
    /// source of truth even when <see cref="AssignedToUserId"/> is null).</summary>
    public string? AssignedToUserName { get; set; }

    /// <summary>Resolved backend User id of whoever made the decision, when it
    /// was a real logged-in user (manual reassignment). Null for AUTOMATIC
    /// decisions — there is no user to attribute those to.</summary>
    public int? AssignedByUserId { get; set; }
    /// <summary>Frontend: entry.decidedBy — "System" for AUTOMATIC decisions
    /// (stored here as "System (Auto)"), or the acting user's name for a
    /// MANUAL reassignment.</summary>
    public string AssignedByName { get; set; } = "System (Auto)";

    /// <summary>"auto" | "manual" | "unassigned". Frontend: entry.method.</summary>
    public string Method { get; set; } = string.Empty;
    /// <summary>Whether the auto-assignment tie-breaker (least-recently-assigned)
    /// had to run. Frontend: entry.tieBreak.</summary>
    public bool TieBreak { get; set; }
    /// <summary>Only set for MANUAL reassignment — the Login User who was
    /// replaced. Frontend: entry.previousUser.</summary>
    public string? PreviousUserName { get; set; }

    /// <summary>Human-readable reason/summary for this decision (e.g. "Auto-
    /// assigned by Location + least workload" or "Manual reassignment"). Not
    /// present verbatim on the frontend entry object — synthesized at push
    /// time from the same context used for the tracking-timeline comment —
    /// kept here as its own column per the audit-trail requirement.</summary>
    public string? Reason { get; set; }

    /// <summary>Raw JSON snapshot of entry.candidates (the workload count per
    /// eligible user considered for this decision). Stored as opaque JSON
    /// rather than a normalized child table — this is a point-in-time audit
    /// snapshot, never queried or updated after insert.</summary>
    public string? CandidatesJson { get; set; }

    /// <summary>When the decision was made (frontend: entry.timestamp —
    /// client clock, preserved as the business timestamp).</summary>
    public DateTime AssignedAt { get; set; }

    /// <summary>When this row was inserted into the database (server clock).</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Loan? LoanApplication { get; set; }
}
