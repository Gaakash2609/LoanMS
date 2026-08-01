using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilRiskFactorDto
{
    public string? Factor { get; set; }
    public string? Impact { get; set; } // Positive, Negative, Neutral
    public int Weight { get; set; } // 0-100
    public string? Description { get; set; }
}
