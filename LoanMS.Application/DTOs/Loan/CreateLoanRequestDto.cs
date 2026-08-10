using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CreateLoanRequestDto
{
    [Required] public int CustomerId { get; set; }
    [Required] public LoanType LoanType { get; set; }
    [Required] [Range(1000, 100000000)] public decimal RequestedAmount { get; set; }
    [Required] [Range(0.1, 100)] public decimal InterestRate { get; set; }
    [Required] [Range(1, 360)] public int TenureMonths { get; set; }
    public string? Purpose { get; set; }
    public string? Remarks { get; set; }
    public int? AssignedToUserId { get; set; }
    // Login Team processing assignee — distinct from AssignedToUserId (Sales
    // Person). See LoanRepository.ApplyVisibilityScope (LoginTeam/
    // OperationManager) for how this drives visibility.
    public int? LoginUserId { get; set; }
}
