using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class BureauAccountDto
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
    
    public decimal SanctionAmount { get; set; }
    public decimal CurrentBalance { get; set; }
    public decimal EMIAmount { get; set; }
    
    public int TenureMonths { get; set; }
    public int RemainingTenure { get; set; }
    
    public string? PaymentFrequency { get; set; }
    public string? AccountStatus { get; set; }
    public int CurrentDPD { get; set; }
    
    public bool IsWrittenOff { get; set; }
    public bool IsSettled { get; set; }
}
