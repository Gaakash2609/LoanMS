using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Assignment Log (Phase 5C) ────────────────────────────────────────────────
/// <summary>
/// Immutable, insert-only audit trail of "who assigned what to whom" across
/// the app's existing assignment-capable flows (Task creation, Ticket
/// creation/reassignment). Mirrors AuditLog's shape deliberately — same
/// "no BaseEntity, no soft-delete, no update, only ever inserted" pattern —
/// since this is a specialised, structured view of the same kind of event
/// the generic AuditMiddleware already captures for every write, but with
/// the from/to user identities pulled out into dedicated columns instead of
/// being buried in a raw JSON request body.
/// AssignedByUserId is always populated from the authenticated JWT user
/// (BaseController.CurrentUserId) at the call site — never from client input.
/// </summary>
public class AssignmentLog
{
    public int Id { get; set; }
    public string EntityType { get; set; } = string.Empty; // "Task" | "Ticket"
    public int EntityId { get; set; }
    public int? FromUserId { get; set; }
    public string? FromUserName { get; set; }
    public int ToUserId { get; set; }
    public string ToUserName { get; set; } = string.Empty;
    public int AssignedByUserId { get; set; }
    public string? AssignedByName { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
