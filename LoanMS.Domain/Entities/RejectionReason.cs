using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Rejection Reason (Policy & Product page) ─────────────────────────────────
/// <summary>
/// Master list of loan-rejection reasons shown in the Reject Application modal.
/// Was frontend-only (rejection-reasons.js, localStorage key '_pp_rejection_reasons')
/// — edits by one admin/device never appeared for anyone else. Standalone
/// master data, not referenced by FK from Loan/Customer, so no existing
/// relationships are affected by this addition.
/// </summary>
public class RejectionReason : BaseEntity
{
    /// <summary>Stable slug used as the option value (e.g. "address", "afford").</summary>
    public string Key { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public int SortOrder { get; set; } = 0;

    /// <summary>User who created this reason (for audit; not used for ownership checks).</summary>
    public int? CreatedByUserId { get; set; }
}
