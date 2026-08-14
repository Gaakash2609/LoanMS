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

    // Unique, permanent Employee Code / User ID: MH-{ROLE}-{LOCATION}-{RANDOM4}
    // (e.g. "MH-ADM-HO-5832"). Generated once, server-side, at creation time
    // by EmployeeCodeGenerator — never regenerated on role/location change,
    // since it's a permanent identifier, not a live label. Nullable only to
    // support existing users created before this column existed; the
    // backfill migration fills these in, but the column itself stays
    // nullable rather than a NOT NULL default so a failed/skipped backfill
    // row is visibly "not yet assigned" rather than silently wrong.
    public string? EmployeeCode { get; set; }

    // Profile photo (base64 data URL, e.g. "data:image/png;base64,...") set
    // via the self-service PUT /api/users/profile endpoint. Previously only
    // ever stored in browser localStorage (user-profile.js / USER_PROFILES),
    // so it never synced across devices/browsers. Nullable and unbounded —
    // base64 image strings can run to hundreds of KB.
    public string? PhotoData { get; set; }

    // Self-service profile: Address + Bank Details tabs on the User
    // Profile page. Same class of gap as PhoneNumber/PhotoData above —
    // previously localStorage-only (USER_PROFILES), never synced across
    // devices. Kept as plain optional fields (not a child table) since
    // each user has exactly one of each, no history/versioning needed.
    public string? AddressLine1 { get; set; }
    public string? AddressLine2 { get; set; }
    public string? AddressCity { get; set; }
    public string? AddressState { get; set; }
    public string? AddressPostalCode { get; set; }
    public string? BankAccountHolderName { get; set; }
    public string? BankName { get; set; }
    public string? BankAccountType { get; set; }
    public string? BankAccountNumber { get; set; }
    public string? BankIfscCode { get; set; }

    // Security fields
    /// <summary>Forces password change on next login (set true for all seeded users).</summary>
    public bool MustChangePassword { get; set; } = false;
    /// <summary>LEGACY/DEAD FIELD (security audit, confirmed) — not read or
    /// written by the active brute-force-protection mechanism, which uses
    /// the separate LoginAttempt table (per-email + per-IP, see
    /// AuthController.Login) instead. Left in place rather than removed —
    /// not confirmed safe to drop from an existing production schema
    /// without a full reference/migration sweep, and removing it carries
    /// real risk for zero security benefit (it's already inert). Do not
    /// build new logic on this field; use LoginAttempt.</summary>
    public int FailedLoginAttempts { get; set; } = 0;
    /// <summary>LEGACY/DEAD FIELD — see FailedLoginAttempts above for the
    /// same reasoning; superseded by the same LoginAttempt-based mechanism.</summary>
    public DateTime? LockedUntil { get; set; }

    // Navigation
    public ICollection<Loan> CreatedLoans { get; set; } = new List<Loan>();
    public ICollection<Loan> AssignedLoans { get; set; } = new List<Loan>();
    public Location? Location { get; set; }
}
