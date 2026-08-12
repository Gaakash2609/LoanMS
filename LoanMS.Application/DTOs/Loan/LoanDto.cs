using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class LoanDto
{
    public int Id { get; set; }
    public string LoanNumber { get; set; } = string.Empty;
    public string LoanType { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public decimal RequestedAmount { get; set; }
    public decimal? ApprovedAmount { get; set; }
    public decimal InterestRate { get; set; }
    public int TenureMonths { get; set; }
    public decimal? MonthlyEmi { get; set; }
    public string? Purpose { get; set; }
    public string? Remarks { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public DateTime? DisbursedAt { get; set; }
    public CustomerDto Customer { get; set; } = null!;
    public UserDto CreatedBy { get; set; } = null!;
    public UserDto? AssignedTo { get; set; }
    public UserDto? LoginUser { get; set; }
    // Frontend "Team & Assignment" panel (app.location) reads this — was
    // missing entirely (Loan.LocationId existed but was never exposed
    // through this DTO), so the field always showed blank there even for
    // loans that genuinely had a location set.
    public string? LocationName { get; set; }
    // Channel Overview display (app.channelDSA/channelPartner) — Loan.
    // DsaId/PartnerId were already being saved correctly on wizard submit,
    // but LoanDto never exposed the resolved names, so the frontend had no
    // way to show them back on the Overview tab regardless of any
    // frontend-side fix.
    public string? DsaName { get; set; }
    public string? PartnerName { get; set; }
    public string? SalesTeamName { get; set; }
    public UserDto? OpsManager { get; set; }
    public List<LoanBankLineDto> BankLines { get; set; } = new();
    public List<LoanReferenceDto> References { get; set; } = new();
    public LoanSanctionDetailDto? SanctionDetail { get; set; }
    /// <summary>Raw JSON of product-specific wizard fields (Insurance/
    /// Property/Vehicle/Education) — frontend parses this back into the
    /// individual app.insXxx/propXxx/carXxx/eduXxx fields it already
    /// expects.</summary>
    public string? ProductDataJson { get; set; }
    // Same field/source as LoanListDto.RiskGrade — see that DTO's comment.
    public string? RiskGrade { get; set; }
    public DateTime CreatedAt { get; set; }
    public List<LoanStatusHistoryDto> StatusHistory { get; set; } = new();
}
