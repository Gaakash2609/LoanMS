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
    public int? UserId { get; set; }
    public string? UserName { get; set; }
    public string? IpAddress { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
