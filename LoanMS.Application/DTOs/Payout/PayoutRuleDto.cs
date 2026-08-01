using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class PayoutRuleDto
{
    public int     Id          { get; set; }
    public string  LoanType    { get; set; } = string.Empty;
    public decimal Percentage  { get; set; }
    public decimal? MinAmount  { get; set; }
    public decimal? MaxAmount  { get; set; }
    public string? Notes       { get; set; }
}
