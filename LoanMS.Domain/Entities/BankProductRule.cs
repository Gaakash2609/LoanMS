namespace LoanMS.Domain.Entities;

// ── Bank Product Rule ─────────────────────────────────────────────────────────
// Per-product-type variation of a bank's eligibility rules (e.g. a bank's
// Personal Loan rules can differ from its Business Loan rules) — the
// frontend's bank.productRules[productKey]. BankMaster's own flat
// MinCibil/MaxLoanAmt/etc fields remain the single-set-of-rules the wizard's
// eligibility engine actually reads today; this table is the fuller,
// per-product picture the Lender Configuration screen edits, confirmed
// previously local-only (lost on refresh).
public class BankProductRule : BaseEntity
{
    public int BankId { get; set; }
    /// <summary>Frontend product key, e.g. "business_loan", "personal_loan".</summary>
    public string ProductKey { get; set; } = string.Empty;

    public int?     MinCibil { get; set; }
    public bool     AcceptNtc { get; set; }
    public decimal? MaxLoanAmt { get; set; }
    public int?     MinTenure { get; set; }
    public int?     MaxTenure { get; set; }
    public int?     FoirLimit { get; set; }
    public bool     PfRequired { get; set; }
    public int?     MinAge { get; set; }
    public int?     MaxAge { get; set; }
    public int?     MinExpMonths { get; set; }
    public string   EmpTypesJson  { get; set; } = "[]";
    public string   CompTypesJson { get; set; } = "[]";
    public string   HomeTypesJson { get; set; } = "[]";

    public BankMaster Bank { get; set; } = null!;
}
