using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilPDFExportRequestDto
{
    public int CibilReportId { get; set; }
    public bool IncludeAccountDetails { get; set; } = true;
    public bool IncludePaymentHistory { get; set; } = true;
    public bool IncludeRiskAnalysis { get; set; } = true;
}
