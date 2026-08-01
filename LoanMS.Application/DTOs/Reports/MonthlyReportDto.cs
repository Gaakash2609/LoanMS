using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class MonthlyReportDto
{
    public string  Month          { get; set; } = string.Empty;
    public int     TotalApps      { get; set; }
    public int     Approved       { get; set; }
    public int     Rejected       { get; set; }
    public int     Disbursed      { get; set; }
    public decimal TotalAmount    { get; set; }
    public decimal DisbursedAmt   { get; set; }
    public decimal ConversionRate { get; set; }
}
