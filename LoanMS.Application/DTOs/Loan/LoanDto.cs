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
    public DateTime CreatedAt { get; set; }
    public List<LoanStatusHistoryDto> StatusHistory { get; set; } = new();
}
