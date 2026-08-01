using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilAccountDto
{
    public int Id { get; set; }
    
    public string? LenderName { get; set; }
    public string? LoanType { get; set; }
    public string? Ownership { get; set; }
    public string? AccountNumberMasked { get; set; }
    
    public DateTime OpenDate { get; set; }
    public DateTime? ClosedDate { get; set; }
    public DateTime ReportDate { get; set; }
    public DateTime? LastPaymentDate { get; set; }
    public DateTime? LastBankUpdate { get; set; }          // CRIF: Last Bank Update date
    
    public decimal SanctionAmount { get; set; }
    public decimal CurrentBalance { get; set; }
    public decimal EMIAmount { get; set; }
    public decimal TotalPaidAmount { get; set; }
    
    public int TenureMonths { get; set; }
    public int RemainingTenure { get; set; }
    public string? RepaymentTenure { get; set; }           // CRIF: e.g. "3 years 8 months"
    
    // CRIF: full account detail fields (PDF page 5-6)
    public decimal? SettlementAmount { get; set; }
    public decimal? WrittenOffPrincipalAmount { get; set; }
    public decimal? WrittenOffTotalAmount { get; set; }
    public decimal? ActualLastPayment { get; set; }
    public decimal? InterestRate { get; set; }
    public string? Collateral { get; set; }
    public string? CollateralType { get; set; }
    public string? SuitFiledStatus { get; set; }
    public decimal? CashLimit { get; set; }
    
    public string? PaymentFrequency { get; set; }
    public string? AccountStatus { get; set; }
    public int CurrentDPD { get; set; }
    public string? AssetClassification { get; set; }
    
    public bool IsWrittenOff { get; set; }
    public bool IsSettled { get; set; }
    public List<CibilMonthlyPaymentStatusDto> PaymentHistory { get; set; } = new();
}
