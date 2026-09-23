namespace LoanMS.Domain.Entities;

// ── Lender Configuration — Per-product income/turnover category ──────────────
/// <summary>
/// A per-product, per-bank income/turnover tier shown in the non-personal
/// multi-config "Categories" tab (efin-app.js lcBlRenderCategories /
/// LA_DB.productCategories[productKey]). Distinct from AnalyticCategory (the
/// global salary tier used by the eligibility-line matching engine): this one
/// is keyed by (ProductKey, BankId) and carries a turnover threshold + a
/// colour tier + free-text notes. Was browser-local-only in legacy; now
/// persisted so it survives refresh like every other config value.
/// </summary>
public class BankProductCategory : BaseEntity
{
    public int      BankId { get; set; }
    /// <summary>Frontend product key, e.g. "business", "home".</summary>
    public string   ProductKey { get; set; } = string.Empty;
    public string   Name { get; set; } = string.Empty;
    public decimal  MinTurnover { get; set; }
    /// <summary>Colour tier: standard / silver / gold / platinum / premium.</summary>
    public string   Color { get; set; } = "standard";
    public string?  Notes { get; set; }

    public BankMaster Bank { get; set; } = null!;
}
