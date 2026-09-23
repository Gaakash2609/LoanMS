using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Audit Log ─────────────────────────────────────────────────────────────────
public class AuditLog
{
    public int Id { get; set; }
    public string EntityName { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty; // Created|Updated|Deleted|StatusChanged
    public string? EntityId { get; set; }
    public string? OldValues { get; set; }
    public string? NewValues { get; set; }
    /// <summary>Phase 2 RBAC — G-23. Structured, first-class reason for a
    /// sensitive action (Admin stage override, etc.). The global AuditMiddleware
    /// also opportunistically lifts a top-level "reason"/"comment" from a write
    /// request body into this column, so reasons are queryable rather than
    /// buried inside NewValues.</summary>
    public string? Reason { get; set; }
    public int? UserId { get; set; }
    public string? UserName { get; set; }
    public string? IpAddress { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
