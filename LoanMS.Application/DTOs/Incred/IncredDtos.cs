namespace LoanMS.Application.DTOs;

// ══════════════════════════════════════════════════════════════════════════════
// InCred loan-level integration DTOs (mirrors incred.integration.mixin fields)
// ══════════════════════════════════════════════════════════════════════════════

public class LoanOfferDto
{
    public int Id { get; set; }
    public string? OfferType { get; set; }
    public decimal LoanAmount { get; set; }
    public int LoanMaxTenure { get; set; }
    public decimal LoanRate { get; set; }
    public decimal ProcessingFee { get; set; }
}

/// <summary>Current InCred state for a single loan — returned on page load and
/// after every action so the UI can render without re-hitting InCred.</summary>
public class IncredLoanInfoDto
{
    public int LoanId { get; set; }
    public bool IsIncredApplication { get; set; }
    public string? ApplicationSource { get; set; }
    public string? IncredApplicationId { get; set; }
    public string? IncredCustomerId { get; set; }
    public string? IncredRequestId { get; set; }
    public string? IncredOfferStatus { get; set; }
    public string? IncredErrorMessage { get; set; }
    public string? IncredRejectReason { get; set; }
    public string? IncredLastWebhookEvent { get; set; }
    public string? IncredLastWebhookStatus { get; set; }
    public DateTime? IncredLastSyncedAt { get; set; }
    public List<LoanOfferDto> Offers { get; set; } = new();
}
