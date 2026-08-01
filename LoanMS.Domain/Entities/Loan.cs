using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

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
