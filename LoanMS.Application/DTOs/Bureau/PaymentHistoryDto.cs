using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class PaymentHistoryDto
{
    public List<MonthlyPaymentStatusDto> Monthly { get; set; } = new();
    public DPDHeatmapDto DPDHeatmap { get; set; } = new();
    public DelinquencyTrackerDto DelinquencyTracker { get; set; } = new();
    public List<string> MissedPaymentAlerts { get; set; } = new();
}
