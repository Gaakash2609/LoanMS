using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilReportParseRequestDto
{
    public string? RawContent { get; set; }
    public string? Format { get; set; } // XML, JSON, PDF
}
