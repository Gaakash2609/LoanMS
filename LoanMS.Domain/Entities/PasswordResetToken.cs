using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Password Reset Token ──────────────────────────────────────────────────────
/// <summary>
/// Single-use, time-limited token for password reset.
/// Only the SHA-256 hash is stored — raw token lives only in the email link.
/// </summary>
public class PasswordResetToken : BaseEntity
{
    /// <summary>SHA-256 hex hash of the raw token sent to the user.</summary>
    public string TokenHash { get; set; } = string.Empty;
    public int    UserId    { get; set; }
    public DateTime ExpiresAt { get; set; }
    public bool IsUsed { get; set; } = false;

    // Navigation
    public User User { get; set; } = null!;
}
