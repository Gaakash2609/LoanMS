using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class UpdateLoanStatusRequestDto
{
    [Required] public LoanStatus NewStatus { get; set; }
    public decimal? ApprovedAmount { get; set; }
    public string? Comment { get; set; }
}
