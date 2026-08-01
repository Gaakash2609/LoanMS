using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class RiskAnalysisDto
{
    public string? RiskLevel { get; set; } // Low, Medium, High
    public string? RiskGrade { get; set; } // A, B, C, D, E
    public decimal BureauRiskScore { get; set; } // 0-100
    
    public int ApprovalProbability { get; set; } // 0-100%
    public string? LendingRecommendation { get; set; } // Approve, Review, Reject
    
    public List<RiskFactorDto> RiskFactors { get; set; } = new();
    public List<string> RiskWarnings { get; set; } = new();
    public List<string> Recommendations { get; set; } = new();
}
