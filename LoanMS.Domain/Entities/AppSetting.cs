using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Settings ──────────────────────────────────────────────────────────────────
public class AppSetting : BaseEntity
{
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string? Category { get; set; }

    // NULL = organization-wide setting (Admin Master Control, Menu Visibility,
    // InCred/AI/Email config, etc. — the original behaviour, unchanged).
    // Non-null = this row belongs to exactly one user (e.g. their own User
    // Profile data). Always populated from the authenticated JWT user
    // (BaseController.CurrentUserId) at the call site — never from client
    // input — same convention as AssignmentLog.AssignedByUserId.
    public int? UserId { get; set; }
}
