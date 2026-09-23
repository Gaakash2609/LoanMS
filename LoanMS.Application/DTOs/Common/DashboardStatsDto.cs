using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class DashboardStatsDto
{
    public int TotalLoans { get; set; }
    public int TotalCustomers { get; set; }
    public int PendingLoans { get; set; }
    public int ApprovedLoans { get; set; }
    public int RejectedLoans { get; set; }
    public int DisbursedLoans { get; set; }
    public decimal TotalRequestedAmount { get; set; }
    public decimal TotalApprovedAmount { get; set; }
    public decimal TotalDisbursedAmount { get; set; }
    public List<LoanListDto> RecentLoans { get; set; } = new();
    // Gap 2 — real persisted activity feed (LoanStatusHistory-backed), see
    // RecentActivityDto. RecentLoans above is left in place (still the most
    // recently CREATED loans, used elsewhere), this is a separate,
    // reverse-chronological feed of actual status-change events.
    public List<RecentActivityDto> RecentActivity { get; set; } = new();
}
