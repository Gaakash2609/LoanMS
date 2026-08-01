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
}
