using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Settings ──────────────────────────────────────────────────────────────────
public class AppSetting : BaseEntity
{
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string? Category { get; set; }
}
