namespace LoanMS.Domain.Entities;

// ── Loan Bank Line ───────────────────────────────────────────────────────────
// Per-bank lender-processing details for a loan (Application Number the bank
// issued, Approved Loan amount, Remarks) — shown/edited on the Applications
// detail page's "Bank Details" table. Was entirely frontend-only (no backend
// representation at all) until this fix: a lender's Application Number or
// Approved Loan entry appeared to save but silently reverted on refresh or a
// different device, since there was nowhere for it to persist. A loan can
// have more than one line (multiple banks the application was sent to).
public class LoanBankLine : BaseEntity
{
    public int LoanId { get; set; }
    public string BankName { get; set; } = string.Empty;
    public string TempApplicationNumber { get; set; } = string.Empty;
    public string? ApplicationNumber { get; set; }
    public decimal? ApprovedLoan { get; set; }
    public string? Remarks { get; set; }

    public Loan Loan { get; set; } = null!;
}
