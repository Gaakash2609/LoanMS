using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilScoreDto
{
    public int Score { get; set; }
    public int MaxScore { get; set; } // 900
    public int MinScore { get; set; } // 300
    public string? Category { get; set; } // Excellent, Good, Fair, Poor, High Risk
    public bool IsLiveScore { get; set; }
    public bool EligibleForLoan { get; set; }
    public DateTime GeneratedDate { get; set; }
    public string? GeneratedTime { get; set; }
    public List<CibilScoreFactorDto> PositiveFactors { get; set; } = new();
    public List<CibilScoreFactorDto> NegativeFactors { get; set; } = new();
}
