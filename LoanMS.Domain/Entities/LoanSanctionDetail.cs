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
