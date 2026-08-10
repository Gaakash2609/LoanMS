namespace LoanMS.Domain.Entities;

// ── Lender Configuration — Category master ───────────────────────────────────
/// <summary>
/// A salary tier (e.g. "Gold" / "Silver" / "Platinum") used by the
/// bank-eligibility matching engine — each BankEligibilityLine pairs a
/// Company with a Category to say "this bank accepts this company's
/// employees at this salary tier". Mirrors LA_DB.categories[] from
/// efin-app.js.
/// </summary>
public class AnalyticCategory : BaseEntity
{
    public string  Name    { get; set; } = string.Empty;
    public decimal Salary  { get; set; }
}
