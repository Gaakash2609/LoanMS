namespace LoanMS.Domain.Entities;

// ── Product Offer Matrix (Policy & Product page) ──────────────────────────
/// <summary>
/// Per-product First Offer matrix (rate/tenure/eligibility rules used to
/// auto-generate a first offer) for one loan product (business_loan,
/// loan_against_property, home_loan, education_loan, new_car_loan,
/// used_car_loan, over_draft, insurance). Was frontend-only (localStorage
/// key 'efin_product_cam_v2') — an admin's edits never applied for anyone
/// else. Stored as JSON since the matrix shape is product-specific and
/// already fully defined/validated in the frontend.
/// </summary>
public class ProductOfferMatrix : BaseEntity
{
    /// <summary>Product key, e.g. "business_loan". Unique.</summary>
    public string ProductKey { get; set; } = string.Empty;
    public string MatrixJson { get; set; } = string.Empty;
}
