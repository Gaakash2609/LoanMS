namespace LoanMS.Domain.Entities;

// ── Offer → Deviation → Credit Approval → Sanction → Disbursement ─────────────
// Application-specific lender offers and everything downstream of them. Kept
// apart from LoanOffer (the InCred API offer mirror) and LoanBankLine (the
// Lender Details processing lines). Status values are plain strings (same
// convention as the rest of the model); the allowed values live in
// OfferWorkflowStatuses below and are enforced by CHECK constraints on
// PostgreSQL. Financial records here are append-only: revisions, credit
// approvals and sanction snapshots are never updated in place.

public static class OfferWorkflowStatuses
{
    // ApplicationOffer.Status
    public const string OfferAvailable   = "Available";
    public const string OfferFinal       = "Final";
    public const string OfferNotSelected = "NotSelected";
    public const string OfferWithdrawn   = "Withdrawn";
    public const string OfferExpired     = "Expired";
    // The live offer set: counts toward the 3-offer limit and the one-per-lender
    // rule. NotSelected offers stay live — they come back to Available when the
    // final selection is cleared — so they must count too. Withdrawn / Expired
    // are history and never block a new offer.
    public static readonly string[] ActiveOfferStatuses = { OfferAvailable, OfferFinal, OfferNotSelected };
    public static readonly string[] AllOfferStatuses = { OfferAvailable, OfferFinal, OfferNotSelected, OfferWithdrawn, OfferExpired };

    // ApplicationOffer.DeviationStatus (offer-level outcome)
    public const string DevNotRequired = "NotRequired";   // rule engine: within policy
    public const string DevRequired    = "Required";      // rule engine: breach / manual review, nothing raised yet
    public const string DevRaised      = "Raised";        // a deviation request is pending a decision
    public const string DevApproved    = "Approved";
    public const string DevRejected    = "Rejected";
    public const string DevSkipped     = "Skipped";       // authorized human bypass (actor + reason recorded)
    public static readonly string[] AllOfferDeviationStatuses = { DevNotRequired, DevRequired, DevRaised, DevApproved, DevRejected, DevSkipped };

    // ApplicationOffer.ApprovalStatus
    public const string ApprovalPending  = "Pending";
    public const string ApprovalApproved = "Approved";
    public const string ApprovalRejected = "Rejected";
    public static readonly string[] AllApprovalStatuses = { ApprovalPending, ApprovalApproved, ApprovalRejected };

    // OfferDeviation.Status (one deviation request)
    public const string RequestRaised   = "Raised";
    public const string RequestApproved = "Approved";
    public const string RequestRejected = "Rejected";
    public const string RequestSkipped  = "Skipped";
    public const string RequestClosed   = "Closed";       // superseded by a revision / application back / rejected
    public static readonly string[] AllRequestStatuses = { RequestRaised, RequestApproved, RequestRejected, RequestSkipped, RequestClosed };

    // Sanction.Status
    public const string SanctionActive    = "Active";
    public const string SanctionCancelled = "Cancelled";
    public static readonly string[] AllSanctionStatuses = { SanctionActive, SanctionCancelled };

    // Disbursement.Status / Type
    public const string DisbursementCompleted = "Completed";
    public const string DisbursementReversed  = "Reversed";
    public const string TypeDisbursement = "Disbursement";
    public const string TypeReversal     = "Reversal";
}

/// <summary>One lender's offer on one application. Terms live in immutable
/// <see cref="ApplicationOfferRevision"/> rows; this row carries identity,
/// status and the pointer to the current revision.</summary>
public class ApplicationOffer : BaseEntity
{
    public int LoanId { get; set; }
    public int BankId { get; set; }
    /// <summary>Lender name at creation (the bank master may be renamed later).</summary>
    public string LenderName { get; set; } = string.Empty;
    public string ProductKey { get; set; } = string.Empty;
    public string LoanType { get; set; } = string.Empty;
    public string Status { get; set; } = OfferWorkflowStatuses.OfferAvailable;
    public string DeviationStatus { get; set; } = OfferWorkflowStatuses.DevRequired;
    public string ApprovalStatus { get; set; } = OfferWorkflowStatuses.ApprovalPending;
    public int CurrentRevisionNo { get; set; } = 1;
    /// <summary>Lender's offer validity (from the offer letter). Null = no expiry on record.</summary>
    public DateTime? ValidUntil { get; set; }
    /// <summary>Optimistic-concurrency counter, bumped on every change.</summary>
    public int Version { get; set; } = 1;
    public DateTime? SelectedAt { get; set; }
    public int? SelectedByUserId { get; set; }
    public int? SelectedRevisionNo { get; set; }
    public string? StatusReason { get; set; }
    public int CreatedByUserId { get; set; }
    public int? UpdatedByUserId { get; set; }
    /// <summary>Latest deviation-engine result for the current revision, when it was
    /// re-evaluated after the revision was saved (bureau report uploaded, rule changed,
    /// credit-approval re-check). Null = the revision's own snapshot is current.</summary>
    public string? LatestEvaluationJson { get; set; }
    public DateTime? LatestEvaluatedAt { get; set; }

    public Loan Loan { get; set; } = null!;
    public BankMaster Bank { get; set; } = null!;
    public ICollection<ApplicationOfferRevision> Revisions { get; set; } = new List<ApplicationOfferRevision>();
}

/// <summary>Immutable snapshot of an offer's terms. A change to any term creates
/// the next revision; nothing is overwritten.</summary>
public class ApplicationOfferRevision
{
    public int Id { get; set; }
    public int OfferId { get; set; }
    public int RevisionNo { get; set; }
    public decimal LoanAmount { get; set; }
    public int TenureMonths { get; set; }
    public decimal BaseRoi { get; set; }
    public decimal OfferedRoi { get; set; }
    public string RateType { get; set; } = "Reducing";
    public decimal ProcessingFeePct { get; set; }
    public decimal ProcessingFeeAmount { get; set; }
    public decimal GstPct { get; set; }
    public decimal GstAmount { get; set; }
    public decimal InsuranceAmount { get; set; }
    public bool PfInBundled { get; set; }
    public bool InsuranceInBundled { get; set; }
    public decimal BtAmount { get; set; }
    public decimal StampDuty { get; set; }
    public decimal FinancedPrincipal { get; set; }
    public decimal Emi { get; set; }
    public decimal NetDisbursement { get; set; }
    public string? ChangeReason { get; set; }
    /// <summary>Deviation-engine result for these terms (JSON).</summary>
    public string? EvaluationJson { get; set; }
    public string EvaluationOutcome { get; set; } = OfferWorkflowStatuses.DevRequired;
    public int CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ApplicationOffer Offer { get; set; } = null!;
}

/// <summary>Configurable, versioned deviation policy rule. A version is never
/// edited: an edit creates Version+1 under the same RuleKey and retires the old
/// one (IsActive=false, SupersededAt set).</summary>
public class DeviationRule
{
    public int Id { get; set; }
    public string RuleKey { get; set; } = string.Empty;
    public int Version { get; set; } = 1;
    public string Name { get; set; } = string.Empty;
    public int BankId { get; set; }
    public string? ProductKey { get; set; }
    public string? LoanType { get; set; }
    /// <summary>ROI / FOIR / LoanAmount / Tenure / CIBIL.</summary>
    public string DeviationType { get; set; } = string.Empty;
    /// <summary>ROI_MIN_PCT / ROI_DISCOUNT_PP / FOIR_MAX_PCT / AMOUNT_MAX / INCOME_MULTIPLE_MAX / TENURE_MAX_MONTHS / TENURE_MIN_MONTHS / CIBIL_MIN.</summary>
    public string Metric { get; set; } = string.Empty;
    public decimal LimitValue { get; set; }
    /// <summary>Optional authority limit: the largest breach (in the metric's unit) that may be approved at all.</summary>
    public decimal? MaxApprovableDeviation { get; set; }
    /// <summary>JSON array of {field, op, value} conditions.</summary>
    public string ConditionsJson { get; set; } = "[]";
    /// <summary>AND / OR across ConditionsJson.</summary>
    public string ConditionLogic { get; set; } = "AND";
    /// <summary>Lower number wins.</summary>
    public int Priority { get; set; } = 100;
    public DateTime EffectiveFrom { get; set; }
    public DateTime? EffectiveTo { get; set; }
    public bool IsActive { get; set; } = true;
    public bool ApprovalRequired { get; set; } = true;
    public string? Notes { get; set; }
    public int CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SupersededAt { get; set; }
    public DateTime? DeactivatedAt { get; set; }
    public int? DeactivatedByUserId { get; set; }

    public BankMaster Bank { get; set; } = null!;
}

/// <summary>One deviation request on a final offer revision.</summary>
public class OfferDeviation
{
    public int Id { get; set; }
    public int LoanId { get; set; }
    public int OfferId { get; set; }
    public int RevisionNo { get; set; }
    public int BankId { get; set; }
    /// <summary>FOIR / CIBIL / Income / Tenure / LoanAmount / ROI / Employment / Document / Other / Multiple.</summary>
    public string DeviationType { get; set; } = string.Empty;
    /// <summary>Auto (rule engine flags) or Manual.</summary>
    public string Source { get; set; } = "Manual";
    public string Status { get; set; } = OfferWorkflowStatuses.RequestRaised;
    public string Reason { get; set; } = string.Empty;
    /// <summary>Engine flags + rule snapshots at raise time (JSON).</summary>
    public string? RuleSnapshotJson { get; set; }
    /// <summary>Offer terms at raise time (JSON).</summary>
    public string? OfferSnapshotJson { get; set; }
    public int RaisedByUserId { get; set; }
    public DateTime RaisedAt { get; set; } = DateTime.UtcNow;
    public int? AssignedApproverId { get; set; }
    /// <summary>Assigned / Escalated (no eligible alternate approver).</summary>
    public string AssignmentState { get; set; } = "Assigned";
    public int? DecidedByUserId { get; set; }
    public DateTime? DecidedAt { get; set; }
    public string? DecisionComment { get; set; }
    public string? ClosedReason { get; set; }
    public string? IdempotencyKey { get; set; }
    public string? DecisionIdempotencyKey { get; set; }
    public int? TaskId { get; set; }
}

/// <summary>Credit (offer terms) approval decision — separate from deviation approval. Immutable.</summary>
public class CreditApproval
{
    public int Id { get; set; }
    public int LoanId { get; set; }
    public int OfferId { get; set; }
    public int RevisionNo { get; set; }
    public int BankId { get; set; }
    public string LenderName { get; set; } = string.Empty;
    /// <summary>Approved / Rejected.</summary>
    public string Decision { get; set; } = string.Empty;
    public string? Comment { get; set; }
    public string TermsSnapshotJson { get; set; } = "{}";
    public string? DeviationRefsJson { get; set; }
    public string DeviationStatusAtApproval { get; set; } = string.Empty;
    public int ApproverUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>False once invalidated (new revision, sanction cancel, application back/reject).</summary>
    public bool IsCurrent { get; set; } = true;
    public string? IdempotencyKey { get; set; }
}

/// <summary>Immutable sanction snapshot. Only Status/cancellation fields may change.</summary>
public class Sanction
{
    public int Id { get; set; }
    public int LoanId { get; set; }
    public string SanctionNumber { get; set; } = string.Empty;
    public int SanctionVersion { get; set; } = 1;
    public int? PreviousSanctionId { get; set; }
    public int OfferId { get; set; }
    public int RevisionNo { get; set; }
    public int CreditApprovalId { get; set; }
    public int BankId { get; set; }
    public string LenderName { get; set; } = string.Empty;
    public decimal LoanAmount { get; set; }
    public int TenureMonths { get; set; }
    public decimal Roi { get; set; }
    public decimal Emi { get; set; }
    public decimal ProcessingFeePct { get; set; }
    public decimal ProcessingFeeAmount { get; set; }
    public decimal GstPct { get; set; }
    public decimal GstAmount { get; set; }
    public decimal InsuranceAmount { get; set; }
    public decimal BtAmount { get; set; }
    public decimal StampDuty { get; set; }
    public decimal FinancedPrincipal { get; set; }
    public decimal NetDisbursement { get; set; }
    public string? DeviationRefsJson { get; set; }
    public string Status { get; set; } = OfferWorkflowStatuses.SanctionActive;
    public int GeneratedByUserId { get; set; }
    public DateTime GeneratedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Cancel / Revoke / Amendment.</summary>
    public string? CancellationType { get; set; }
    public string? CancelReason { get; set; }
    public int? CancelledByUserId { get; set; }
    public DateTime? CancelledAt { get; set; }
    public string? IdempotencyKey { get; set; }
}

/// <summary>Money movement record. Never deleted; a reversal is its own row.</summary>
public class Disbursement
{
    public int Id { get; set; }
    public int LoanId { get; set; }
    public int SanctionId { get; set; }
    public string Type { get; set; } = OfferWorkflowStatuses.TypeDisbursement;
    public int? ReversalOfId { get; set; }
    public decimal Amount { get; set; }
    public DateTime DisbursementDate { get; set; }
    public string BankAccountNumber { get; set; } = string.Empty;
    public string Ifsc { get; set; } = string.Empty;
    public string? AccountHolderName { get; set; }
    public string Utr { get; set; } = string.Empty;
    public string? LenderReference { get; set; }
    /// <summary>NEFT / RTGS / IMPS / Cheque / Other.</summary>
    public string Mode { get; set; } = string.Empty;
    public string Status { get; set; } = OfferWorkflowStatuses.DisbursementCompleted;
    public string? Reason { get; set; }
    /// <summary>Application status right before this disbursement (restored on reversal).</summary>
    public string? PreviousLoanStatus { get; set; }
    public int CreatedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string? IdempotencyKey { get; set; }
}
