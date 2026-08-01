using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilReportSummaryDto
{
    public int Id { get; set; }
    public string? CustomerName { get; set; }
    public int CreditScore { get; set; }
    public string? RiskCategory { get; set; }
    public string? RiskLevel { get; set; }
    public int ApprovalProbability { get; set; }
    public bool EligibleForLoan { get; set; }
    public DateTime GeneratedDate { get; set; }
    public string? LendingRecommendation { get; set; }
}
