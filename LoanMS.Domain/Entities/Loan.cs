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
    /// <summary>JSON blob for product-specific wizard fields (Insurance:
    /// nominee/insurer/premium; Property: builder/city/value; Vehicle:
    /// make/model/dealer; Education: institution/course) — confirmed
    /// never reaching WizardSubmitDto at all, so a flexible JSON column
    /// rather than ~28 rigid typed ones (most NULL for any given loan,
    /// since only one product-category's fields are ever relevant per
    /// loan). Same JSON-blob convention already used for
    /// BankMaster.EmpTypesJson etc.</summary>
    public string? ProductDataJson { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public DateTime? DisbursedAt { get; set; }
    public DateTime? ClosedAt { get; set; }

    // ── Wizard draft progress (server-side — replaces the old client-only
    // localStorage "wizard_draft_meta" index) ─────────────────────────────
    // Which step of the New Application wizard this Draft-status loan was
    // last saved on. Only ever meaningful while Status == Draft; lets the
    // "Applications → Drafts" list and a resumed session pick up on the
    // exact same step from any device, with nothing kept in the browser.
    public int? WizardStep { get; set; }

    // Foreign Keys
    public int CustomerId { get; set; }
    public int CreatedByUserId { get; set; }
    public int? AssignedToUserId { get; set; }

    // ── Login Team / Operation Manager visibility (added per business owner
    // request) — distinct from AssignedToUserId, which is dedicated to the
    // Sales Person (see Wizard Sales Person Assignment). LoginUserId is who
    // is actually processing this loan in the Login/Process stage, letting
    // an individual Login Team member see only their own queue, and an
    // Operation Manager supervise their whole team's queue, instead of the
    // Location-based proxy used before this field existed.
    public int? LoginUserId { get; set; }

    // ── SLA breach notification dedupe (added) ──────────────────────────────
    // Set when a background job (SlaAndTaskAutomationService) creates an
    // overdue-SLA notification for this loan's CURRENT status (SLA clock =
    // time since the last LoanStatusHistory entry, or CreatedAt if none —
    // same rule the existing SLA badge already uses client-side). Reset to
    // null every time the loan's Status actually changes (see
    // LoanService.UpdateStatusAsync), so a loan that breaches again in its
    // NEXT status is eligible for a fresh notification, but the same
    // breach episode is never notified twice.
    public DateTime? SlaBreachNotifiedAt { get; set; }

    // ── Step 9 Loan Analytics — selected lender round-trip (added) ─────────
    // Dedicated field so Step 9's bank-eligibility selection round-trips
    // cleanly through GetDraft (resume) without needing to parse it back out
    // of the combined Remarks text (Remarks already embeds a "Lender: ..."
    // fragment for audit-trail/human-readable purposes — kept as-is,
    // unrelated to this field). Comma-separated bank names, current
    // selection only (overwritten on each save, not a history log).
    public string? SelectedLenderNames { get; set; }

    // ── DSA / Partner / Location linkage (Phase 1 — data model only; no
    // wizard mapping, visibility, authorization, or assignment logic yet) ────
    public int? DsaId { get; set; }
    public int? PartnerId { get; set; }
    public int? LocationId { get; set; }

    // ── Sales Team / Operations Manager (linked-users visibility fix) ────────
    // Was frontend-only (never persisted) — the UI's Team & Assignment panel
    // let an Admin/Manager pick and "save" a Sales Team and Operations
    // Manager for an application, but nothing about that selection reached
    // the database, so it silently reverted on refresh or a different
    // device. SalesTeamName mirrors User.SalesTeam's own string-name
    // convention (Teams aren't referenced by FK anywhere else in this
    // model either); OpsManagerId mirrors LoginUserId's User-reference
    // pattern above.
    public string? SalesTeamName { get; set; }
    public int? OpsManagerId { get; set; }

    // ── Bank Lines (linked-users/flow persistence sweep) — per-bank lender
    // processing details, previously frontend-only. See LoanBankLine.cs. ──
    public ICollection<LoanBankLine> BankLines { get; set; } = new List<LoanBankLine>();
    // References tab — data has existed since the wizard submit flow
    // (WizardController writes LoanReference rows on submit), but was
    // never exposed through LoanDto/GetById at all — this navigation
    // property didn't even exist. Same class of "data exists, was never
    // read back" gap as Location/DsaName/PartnerName before those were
    // fixed.
    public ICollection<LoanReference> References { get; set; } = new List<LoanReference>();
    public ICollection<PerfiosReport> PerfiosReports { get; set; } = new List<PerfiosReport>();
    public LoanSanctionDetail? SanctionDetail { get; set; }

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
    public User? LoginUser { get; set; }
    public User? OpsManager { get; set; }
    public DsaPartner? Dsa { get; set; }
    public DsaPartner? Partner { get; set; }
    public Location? Location { get; set; }
    public ICollection<LoanDocument> Documents { get; set; } = new List<LoanDocument>();
    public ICollection<LoanStatusHistory> StatusHistory { get; set; } = new List<LoanStatusHistory>();
    public ICollection<LoanOffer> IncredOffers { get; set; } = new List<LoanOffer>();
}
