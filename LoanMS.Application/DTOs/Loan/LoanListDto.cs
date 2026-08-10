using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class LoanListDto
{
    public int Id { get; set; }
    public string LoanNumber { get; set; } = string.Empty;
    public string LoanType { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public decimal RequestedAmount { get; set; }
    public decimal? ApprovedAmount { get; set; }
    public decimal InterestRate { get; set; }
    public int TenureMonths { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerPhone { get; set; } = string.Empty;
    public string CreatedByName { get; set; } = string.Empty;
    public string? AssignedToName { get; set; }
    public string? LoginUserName { get; set; }
    // Productivity audit (P1) — surfaces the customer's latest bureau risk
    // grade (already computed and persisted on BureauReport when a report
    // is generated — see CibilAnalysisService.GetRiskGrade — this reads
    // the existing stored value, doesn't recompute anything) so it's
    // visible for sort/filter/triage on the Applications list instead of
    // being buried inside each application's CIBIL tab.
    public string? RiskGrade { get; set; }
    public DateTime CreatedAt { get; set; }
}
