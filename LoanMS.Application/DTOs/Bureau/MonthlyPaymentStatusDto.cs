using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class MonthlyPaymentStatusDto
{
    public DateTime ReportMonth { get; set; }
    public string? DPDStatus { get; set; } // 000, 030, 060, 090, 120+, WO, SO
    public int DaysOverdue { get; set; }
    public bool IsMissedPayment { get; set; }
    public bool IsWriteOff { get; set; }
    public bool IsSettlement { get; set; }
}
