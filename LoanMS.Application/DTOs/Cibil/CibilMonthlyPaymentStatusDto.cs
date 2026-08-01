using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilMonthlyPaymentStatusDto
{
    public DateTime ReportMonth { get; set; }
    public string? DPDStatus { get; set; } // 000, 030, 060, 090, 120+, WO, SO
    public int DaysOverdue { get; set; }
    public bool IsMissedPayment { get; set; }
    public bool IsWriteOff { get; set; }
    public bool IsSettlement { get; set; }
    // NEW: scheduled and actual paid amounts for payment history detail
    public decimal ScheduledAmount { get; set; }
    public decimal PaidAmount { get; set; }
}
