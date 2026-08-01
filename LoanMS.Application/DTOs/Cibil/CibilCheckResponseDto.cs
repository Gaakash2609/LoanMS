using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilCheckResponseDto
{
    public string Pan         { get; set; } = string.Empty;
    public int?   CibilScore  { get; set; }
    public string Status      { get; set; } = string.Empty;
    public string? Message    { get; set; }
    public bool   IsEligible  { get; set; }
    public string Source      { get; set; } = "Bureau";
}
