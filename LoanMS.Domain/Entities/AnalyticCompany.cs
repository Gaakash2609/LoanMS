namespace LoanMS.Domain.Entities;

// ── Lender Configuration — Company master ────────────────────────────────────
/// <summary>
/// A named employer used by the bank-eligibility matching engine (Loan
/// Analytics / Wizard Step 9) — "Path A" banks only approve applicants whose
/// employer is in their line list (see BankEligibilityLine). Mirrors
/// LA_DB.companies[] from efin-app.js.
/// </summary>
public class AnalyticCompany : BaseEntity
{
    public string  Name        { get; set; } = string.Empty;
    /// <summary>JSON string array, e.g. ["SALARIED","SELFEMP"].</summary>
    public string  EmpTypesJson { get; set; } = "[]";
    public string? CompType    { get; set; }
}
