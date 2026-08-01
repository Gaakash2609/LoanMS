using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilPaymentHistoryDto
{
    public List<CibilMonthlyPaymentStatusDto> Monthly { get; set; } = new();
    public CibilDPDHeatmapDto DPDHeatmap { get; set; } = new();
    public CibilDelinquencyTrackerDto DelinquencyTracker { get; set; } = new();
    public List<string> MissedPaymentAlerts { get; set; } = new();
}
