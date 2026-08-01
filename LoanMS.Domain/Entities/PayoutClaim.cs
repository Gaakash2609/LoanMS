using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

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
