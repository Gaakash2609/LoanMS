using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class PayoutAutoCalcDto
{
    public int     LoanId      { get; set; }
    public decimal LoanAmount  { get; set; }
    public string  LoanType    { get; set; } = string.Empty;
    public decimal PayoutRate  { get; set; }
    public decimal PayoutAmount { get; set; }
    public string  Formula     { get; set; } = string.Empty;
}
