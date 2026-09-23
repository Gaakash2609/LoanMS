namespace LoanMS.Domain.Entities;

// ── Loan Sanction Detail ──────────────────────────────────────────────────────
// The editable "Approval Details" panel's fields beyond the core
// ApprovedAmount/InterestRate/TenureMonths/MonthlyEmi already on Loan
// itself (Stamp Duty, GST, Insurance, PF%, Bundled flags, BT flag, Flat
// Rate, EMI Date) — confirmed local-only (approvalFieldSave() in
// efin-app.js never called an API). One row per loan (created on first
// save, updated thereafter) rather than a Loan column each, to keep this
// clearly-separable "sanction paperwork" concern out of the core Loan
// entity that everything else already depends on.
public class LoanSanctionDetail : BaseEntity
{
    public int LoanId { get; set; }
    // Sanctioned loan terms — the "Approval Details / CAM" figures the
    // underwriter finalises, which may differ from the customer's requested
    // terms. In legacy (efin-app.js renderDetailApproval) these were the
    // sanctionLoanAmt / sanctionTenureMo / sanctionROI / sanctionEMI fields,
    // but legacy's approvalFieldSave never persisted them (browser-memory only —
    // they reset on reload). They live here now so the CAM's Loan Amount /
    // Tenure / ROI / EMI edits survive a refresh, without touching the Loan's
    // own approval fields. Nullable: a row falls back to the Loan's
    // ApprovedAmount/TenureMonths/InterestRate/MonthlyEmi when unset.
    public decimal? SanctionLoanAmt { get; set; }
    public int? SanctionTenureMonths { get; set; }
    public decimal? SanctionRoi { get; set; }
    public decimal? SanctionEmi { get; set; }
    public string? StampDuty { get; set; }
    public decimal? Gst { get; set; }
    public decimal? Insurance { get; set; }
    public decimal? PfPercent { get; set; }
    public bool InsuranceInBundled { get; set; }
    public bool PfInBundled { get; set; }
    public bool IsBundled { get; set; }
    public bool IsBt { get; set; }
    public decimal? FlatRate { get; set; }
    public DateTime? EmiDate { get; set; }

    public Loan Loan { get; set; } = null!;
}
