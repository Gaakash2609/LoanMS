namespace LoanMS.Domain.Entities;

// ── Lender Configuration — Bank eligibility line ──────────────────────────────
/// <summary>
/// One row of a bank's "Path A — Company List" eligibility matrix: this Bank
/// accepts applicants from this Company, in this salary Category, at this
/// PIN code (PF required or not). Mirrors LA_DB.banks[].lines[] from
/// efin-app.js. A bank with zero lines is "Path B — Open List" (matched only
/// on the bank-level rules: CIBIL, FOIR, employment type, etc — no
/// company/category/PIN restriction).
/// </summary>
public class BankEligibilityLine : BaseEntity
{
    public int BankId     { get; set; }
    public int CompanyId  { get; set; }
    public int CategoryId { get; set; }
    public string? PinCode { get; set; }
    public bool Pf         { get; set; }

    public BankMaster?      Bank     { get; set; }
    public AnalyticCompany? Company  { get; set; }
    public AnalyticCategory? Category { get; set; }
}
