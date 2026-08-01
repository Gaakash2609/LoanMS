using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class CreditScoreDto
{
    public int Score { get; set; }
    public int MaxScore { get; set; } // 900
    public int MinScore { get; set; } // 300
    public string? Category { get; set; } // Excellent, Good, Fair, Poor, High Risk
    public bool IsLiveScore { get; set; }
    public bool EligibleForLoan { get; set; }
    public DateTime GeneratedDate { get; set; }
    public string? GeneratedTime { get; set; }
    public List<ScoreFactorDto> PositiveFactors { get; set; } = new();
    public List<ScoreFactorDto> NegativeFactors { get; set; } = new();
}
