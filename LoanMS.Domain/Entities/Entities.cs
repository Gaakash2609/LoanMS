using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Base Entity ───────────────────────────────────────────────────────────────
public abstract class BaseEntity
{
    public int Id { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public bool IsDeleted { get; set; } = false;
}

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

// ── Customer ──────────────────────────────────────────────────────────────────
public class Customer : BaseEntity
{
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string? PanNumber { get; set; }
    public string? AadhaarNumber { get; set; }
    public DateTime? DateOfBirth { get; set; }
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? PinCode { get; set; }
    public decimal? MonthlyIncome { get; set; }
    public string? EmploymentType { get; set; }
    public string? CompanyName { get; set; }
    public int? CibilScore { get; set; }

    // Navigation
    public ICollection<Loan> Loans { get; set; } = new List<Loan>();
}

// ── Loan ──────────────────────────────────────────────────────────────────────
public class Loan : BaseEntity
{
    public string LoanNumber { get; set; } = string.Empty;
    public LoanType LoanType { get; set; }
    public LoanStatus Status { get; set; } = LoanStatus.Draft;
    public decimal RequestedAmount { get; set; }
    public decimal? ApprovedAmount { get; set; }
    public decimal InterestRate { get; set; }
    public int TenureMonths { get; set; }
    public decimal? MonthlyEmi { get; set; }
    public string? Purpose { get; set; }
    public string? Remarks { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public DateTime? DisbursedAt { get; set; }
    public DateTime? ClosedAt { get; set; }

    // Foreign Keys
    public int CustomerId { get; set; }
    public int CreatedByUserId { get; set; }
    public int? AssignedToUserId { get; set; }

    // Navigation
    public Customer Customer { get; set; } = null!;
    public User CreatedBy { get; set; } = null!;
    public User? AssignedTo { get; set; }
    public ICollection<LoanDocument> Documents { get; set; } = new List<LoanDocument>();
    public ICollection<LoanStatusHistory> StatusHistory { get; set; } = new List<LoanStatusHistory>();
}

// ── Loan Document ─────────────────────────────────────────────────────────────
public class LoanDocument : BaseEntity
{
    public int LoanId { get; set; }
    public string DocumentName { get; set; } = string.Empty;
    public string DocumentType { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public long FileSizeBytes { get; set; }
    public string UploadedByUserId { get; set; } = string.Empty;

    // Navigation
    public Loan Loan { get; set; } = null!;
}

// ── Loan Status History ───────────────────────────────────────────────────────
public class LoanStatusHistory : BaseEntity
{
    public int LoanId { get; set; }
    public LoanStatus FromStatus { get; set; }
    public LoanStatus ToStatus { get; set; }
    public string? Comment { get; set; }
    public int ChangedByUserId { get; set; }

    public Loan Loan { get; set; } = null!;
    public User ChangedBy { get; set; } = null!;
}

// ── Tracking Entry ────────────────────────────────────────────────────────────
public class TrackingEntry : BaseEntity
{
    public int LoanId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Stage { get; set; } = string.Empty;
    public string AssignedUser { get; set; } = string.Empty;
    public string Status { get; set; } = "Pending";
    public string? Comment { get; set; }
    public string? SubNote { get; set; }
    public int CreatedByUserId { get; set; }

    public Loan Loan { get; set; } = null!;
    public User CreatedBy { get; set; } = null!;
}

// ── Task ──────────────────────────────────────────────────────────────────────
public class LoanTask : BaseEntity
{
    public int? LoanId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Priority { get; set; } = "Medium";
    public bool IsCompleted { get; set; } = false;
    public DateTime? DueDate { get; set; }
    public int AssignedToUserId { get; set; }
    public int CreatedByUserId { get; set; }

    public Loan? Loan { get; set; }
    public User AssignedTo { get; set; } = null!;
    public User CreatedBy { get; set; } = null!;
}

// ── Ticket ────────────────────────────────────────────────────────────────────
public class Ticket : BaseEntity
{
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Status { get; set; } = "Open";
    public string Priority { get; set; } = "Medium";
    public int? LoanId { get; set; }
    public int CreatedByUserId { get; set; }
    public int? AssignedToUserId { get; set; }
    public DateTime? ClosedAt { get; set; }

    public Loan? Loan { get; set; }
    public User CreatedBy { get; set; } = null!;
    public User? AssignedTo { get; set; }
}

// ── Payout Claim ──────────────────────────────────────────────────────────────
public class PayoutClaim : BaseEntity
{
    public int LoanId { get; set; }
    public int ClaimedByUserId { get; set; }
    public decimal ClaimAmount { get; set; }
    public string Status { get; set; } = "Pending";
    public string? Month { get; set; }
    public string? Notes { get; set; }
    public DateTime? VerifiedAt { get; set; }
    public DateTime? PaidAt { get; set; }
    public int? ProcessedByUserId { get; set; }

    public Loan Loan { get; set; } = null!;
    public User ClaimedBy { get; set; } = null!;
    public User? ProcessedBy { get; set; }
}

// ── Location ──────────────────────────────────────────────────────────────────
public class Location : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string City { get; set; } = string.Empty;
    public string State { get; set; } = string.Empty;
    public string? PinCode { get; set; }
    public bool IsActive { get; set; } = true;

    public ICollection<User> Users { get; set; } = new List<User>();
}

// ── Team ──────────────────────────────────────────────────────────────────────
public class Team : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = "Sales";  // Sales | Login
    public int? LocationId { get; set; }
    public int? TeamLeadUserId { get; set; }

    public Location? Location { get; set; }
    public User? TeamLead { get; set; }
    public ICollection<TeamMember> Members { get; set; } = new List<TeamMember>();
}

// ── Team Member ───────────────────────────────────────────────────────────────
public class TeamMember : BaseEntity
{
    public int TeamId { get; set; }
    public int UserId { get; set; }

    public Team Team { get; set; } = null!;
    public User User { get; set; } = null!;
}

// ── DSA Partner ───────────────────────────────────────────────────────────────
public class DsaPartner : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? City { get; set; }
    public bool IsActive { get; set; } = true;
    public int? MappedSalesUserId { get; set; }

    public User? MappedSalesUser { get; set; }
}

// ── Settings ──────────────────────────────────────────────────────────────────
public class AppSetting : BaseEntity
{
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string? Category { get; set; }
}

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


// ── Payout Rule ───────────────────────────────────────────────────────────────
public class PayoutRule : BaseEntity
{
    public string  LoanType    { get; set; } = string.Empty; // personal_loan|business_loan|home_loan etc
    public decimal Percentage  { get; set; } = 1.0m;         // % of approved/disbursed amount
    public decimal? MinPayout  { get; set; }                  // Minimum payout amount
    public decimal? MaxPayout  { get; set; }                  // Maximum payout cap
    public bool    IsActive    { get; set; } = true;
    public string? Notes       { get; set; }
}

// ── Loan Reference ────────────────────────────────────────────────────────────
public class LoanReference : BaseEntity
{
    public int    LoanId       { get; set; }
    public string Name         { get; set; } = string.Empty;
    public string Mobile       { get; set; } = string.Empty;
    public string Relation     { get; set; } = string.Empty;
    public int    RefNumber    { get; set; } = 1; // 1 or 2

    public Loan Loan { get; set; } = null!;
}

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

