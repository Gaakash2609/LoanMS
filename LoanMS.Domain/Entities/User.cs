using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── User ──────────────────────────────────────────────────────────────────────
public class User : BaseEntity
{
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public UserRole Role { get; set; } = UserRole.Sales;
    public bool IsActive { get; set; } = true;
    public string? RefreshToken { get; set; }
    public DateTime? RefreshTokenExpiry { get; set; }

    // Added — the Add/Edit User form (twSaveUser, tw-um-mobile/loc/st/ot)
    // already captures these; they simply had nowhere to be saved.
    public string? PhoneNumber { get; set; }
    public string? LocationName { get; set; }
    public string? SalesTeam { get; set; }
    public string? OpTeam { get; set; }

    // Security fields
    /// <summary>Forces password change on next login (set true for all seeded users).</summary>
    public bool MustChangePassword { get; set; } = false;
    /// <summary>Consecutive failed login attempts — reset to 0 on success.</summary>
    public int FailedLoginAttempts { get; set; } = 0;
    /// <summary>Account locked until this UTC time after too many failures.</summary>
    public DateTime? LockedUntil { get; set; }

    // Navigation
    public ICollection<Loan> CreatedLoans { get; set; } = new List<Loan>();
    public ICollection<Loan> AssignedLoans { get; set; } = new List<Loan>();
}
