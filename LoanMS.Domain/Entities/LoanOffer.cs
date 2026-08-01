using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── InCred Loan Offer (mirrors loan.application.offer) ─────────────────────────
public class LoanOffer : BaseEntity
{
    public int LoanId { get; set; }
    /// <summary>PREAPPROVED / BANKING</summary>
    public string? OfferType { get; set; }
    public decimal LoanAmount { get; set; }
    public int LoanMaxTenure { get; set; }
    public decimal LoanRate { get; set; }
    public decimal ProcessingFee { get; set; }

    // Navigation
    public Loan Loan { get; set; } = null!;
}
