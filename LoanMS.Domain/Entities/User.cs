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

    // ── Location Head visibility (added per business owner request) ──────────
    // A real FK, distinct from the free-text LocationName above.
    // LocationName is display-only, user-typed text and must never be used
    // for authorization (same rule already applied to BankMaster.Location).
    // LocationId is what LoanRepository.ApplyVisibilityScope actually reads
    // to scope a Location Head's loan visibility — independent of any team
    // membership, since a Location Head's access cuts across every team at
    // their Location.
    public int? LocationId { get; set; }

    // Profile photo (base64 data URL, e.g. "data:image/png;base64,...") set
    // via the self-service PUT /api/users/profile endpoint. Previously only
    // ever stored in browser localStorage (user-profile.js / USER_PROFILES),
    // so it never synced across devices/browsers. Nullable and unbounded —
    // base64 image strings can run to hundreds of KB.
    public string? PhotoData { get; set; }

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
    public Location? Location { get; set; }
}
