using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class LoanListDto
{
    public int Id { get; set; }
    public string LoanNumber { get; set; } = string.Empty;
    public string LoanType { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public decimal RequestedAmount { get; set; }
    public decimal? ApprovedAmount { get; set; }
    public decimal InterestRate { get; set; }
    public int TenureMonths { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerPhone { get; set; } = string.Empty;
    public string CreatedByName { get; set; } = string.Empty;
    public string? AssignedToName { get; set; }
    public DateTime CreatedAt { get; set; }
}
