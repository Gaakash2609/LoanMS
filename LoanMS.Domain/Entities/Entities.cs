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
    /// <summary>Existing monthly EMI/debt obligations declared by the applicant — used for FOIR
    /// (Fixed Obligation to Income Ratio) calculations. Captured on the New Application wizard's
    /// Employment step (Phase 5A) and persisted server-side alongside MonthlyIncome.</summary>
    public decimal? MonthlyObligations { get; set; }
    public string? EmploymentType { get; set; }
    public string? CompanyName { get; set; }
    public int? CibilScore { get; set; }

    // ── KYC fields needed for InCred's application/init API ──────────────────
    /// <summary>"M" or "F" — InCred's application/init API requires this exact format.</summary>
    public string? Gender { get; set; }
    /// <summary>Optional on InCred's side (MNAME) but useful KYC data generally.</summary>
    public string? FatherName { get; set; }
    /// <summary>One of InCred's RESIDENCE_TYPE enum values (optional on their side).</summary>
    public string? ResidenceType { get; set; }

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

    // ── DSA / Partner / Location linkage (Phase 1 — data model only; no
    // wizard mapping, visibility, authorization, or assignment logic yet) ────
    public int? DsaId { get; set; }
    public int? PartnerId { get; set; }
    public int? LocationId { get; set; }

    // ── InCred Integration (mirrors incred.integration.mixin) ────────────────────
    /// <summary>Set to "incred" once this loan has been pushed to InCred's digital-partner API.</summary>
    public string? ApplicationSource { get; set; }
    public string? IncredApplicationId { get; set; }
    public string? IncredCustomerId { get; set; }
    public string? IncredRequestId { get; set; }
    /// <summary>pending / completed / rejected / error</summary>
    public string? IncredOfferStatus { get; set; }
    /// <summary>Raw JSON of InCred's last offer/status response — kept for audit/debug.</summary>
    public string? IncredOfferJson { get; set; }
    public string? IncredErrorMessage { get; set; }
    public string? IncredRejectReason { get; set; }
    public string? IncredLastWebhookEvent { get; set; }
    public string? IncredLastWebhookStatus { get; set; }
    public DateTime? IncredLastSyncedAt { get; set; }

    // Navigation
    public Customer Customer { get; set; } = null!;
    public User CreatedBy { get; set; } = null!;
    public User? AssignedTo { get; set; }
    public DsaPartner? Dsa { get; set; }
    public DsaPartner? Partner { get; set; }
    public Location? Location { get; set; }
    public ICollection<LoanDocument> Documents { get; set; } = new List<LoanDocument>();
    public ICollection<LoanStatusHistory> StatusHistory { get; set; } = new List<LoanStatusHistory>();
    public ICollection<LoanOffer> IncredOffers { get; set; } = new List<LoanOffer>();
}

// ── InCred Loan Offer (mirrors loan.application.offer) ─────────────────────────
public class LoanOffer : BaseEntity
{
    public int LoanId { get; set; }
    /// <summary>PREAPPROVED / BANKING</summary>
    public string? OfferType { get; set; }
    public decimal LoanAmount { get; set; }
    public int LoanMaxTenure { get; set; }
    public decimal LoanRate { get; set; }
    public decimal ProcessingFee { get; set; }

    // Navigation
    public Loan Loan { get; set; } = null!;
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

// ── Ticket Comment / Activity ───────────────────────────────────────────────
// Phase 4B: backs the helpdesk ticket comment/notes/activity panel.
// Type "Comment" = user-authored note. Type "Activity" = system-generated
// record written automatically on status or assignment change (Close, Reopen,
// reassignment). Both share one table/timeline so the UI can render them in
// chronological order.
public class TicketComment : BaseEntity
{
    public int TicketId { get; set; }
    public int UserId { get; set; }
    public string Content { get; set; } = string.Empty;
    public string Type { get; set; } = "Comment";

    public Ticket Ticket { get; set; } = null!;
    public User User { get; set; } = null!;
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

    /// <summary>
    /// Phase 3: the capacity in which ClaimedByUserId is claiming on this loan —
    /// "Sales" | "Dsa" | "Partner" | "Login" | "Manager" | "Admin". Lets the same
    /// loan carry one claim per eligible claimant (multi-claimant business logic)
    /// instead of a single claim per loan. Combined with (LoanId, ClaimedByUserId)
    /// this forms the idempotency key that prevents duplicate claims — see the
    /// unique index in AppDbContext.
    /// </summary>
    public string ClaimType { get; set; } = "Sales";

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

    /// <summary>Whether this record represents a DSA or a Partner.</summary>
    public PartnerType PartnerType { get; set; } = PartnerType.Dsa;
    /// <summary>Optional link to the real User account (role Dsa/Partner) that this
    /// DSA/Partner record logs in as. Nullable — a DSA/Partner can exist without
    /// a linked login.</summary>
    public int? LinkedUserId { get; set; }

    // ── Phase 2: fields previously local-only (frontend efin-app.js dsa-f-*/pm-f-*) ──
    /// <summary>PAN card number (frontend: dsa-f-pan).</summary>
    public string? Pan { get; set; }
    /// <summary>Office address line (frontend: dsa-f-office-addr).</summary>
    public string? OfficeAddress { get; set; }
    /// <summary>Office state (frontend: dsa-f-office-state). Office city already
    /// covered by <see cref="City"/>.</summary>
    public string? OfficeState { get; set; }
    /// <summary>Office PIN code (frontend: dsa-f-office-pin).</summary>
    public string? OfficePin { get; set; }
    /// <summary>Office address type — e.g. owned/rented (frontend: dsa-f-office-addr-type).</summary>
    public string? OfficeAddressType { get; set; }
    /// <summary>Partner sub-category — e.g. individual/company (frontend: pm-f-type).
    /// Distinct from <see cref="PartnerType"/>, which distinguishes DSA vs Partner.</summary>
    public string? Category { get; set; }
    /// <summary>For records where PartnerType = Partner: the DSA this Partner is
    /// mapped under (frontend: pm-f-dsa-id / mappedDsaId). Self-referencing FK.</summary>
    public int? MappedDsaId { get; set; }

    public User? MappedSalesUser { get; set; }
    public User? LinkedUser { get; set; }
    public DsaPartner? MappedDsa { get; set; }
    public ICollection<DsaDocument> Documents { get; set; } = new List<DsaDocument>();
}

// ── DSA/Partner uploaded documents (KYC/onboarding docs) ───────────────────────
public class DsaDocument : BaseEntity
{
    public int DsaPartnerId { get; set; }
    public string DocumentName { get; set; } = string.Empty;
    public string DocumentType { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public long FileSizeBytes { get; set; }
    public string UploadedByUserId { get; set; } = string.Empty;

    // Navigation
    public DsaPartner DsaPartner { get; set; } = null!;
}

// ── Settings ──────────────────────────────────────────────────────────────────
public class AppSetting : BaseEntity
{
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string? Category { get; set; }
}

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

// ── Bank Master (Phase 5B) ──────────────────────────────────────────────────
/// <summary>
/// Master list of lender/partner banks (RM contact + IFSC prefix + emp code)
/// managed from the Banks screen. Standalone master data — not currently
/// referenced by Loan/Customer/Payout via foreign key, so no existing
/// relationships are affected by this addition.
/// </summary>
public class BankMaster : BaseEntity
{
    public string  BankName    { get; set; } = string.Empty;
    public string? IfscPrefix  { get; set; }
    public string? EmpCode     { get; set; }
    public string? Location    { get; set; }
    public string? RmName      { get; set; }
    public string? RmMobile    { get; set; }
    public string? Email       { get; set; }
    public string? Remarks     { get; set; }
    public bool    IsActive    { get; set; } = true;

    /// <summary>User who created this bank record (for audit; not used for ownership checks).</summary>
    public int? CreatedByUserId { get; set; }
}

