using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class WizardSubmitResponseDto
{
    public string  EfinId      { get; set; } = string.Empty;
    public int     LoanId      { get; set; }
    public int     CustomerId  { get; set; }
    public string  LoanNumber  { get; set; } = string.Empty;
    public decimal MonthlyEmi  { get; set; }
    public string  Status      { get; set; } = "Submitted";
}
