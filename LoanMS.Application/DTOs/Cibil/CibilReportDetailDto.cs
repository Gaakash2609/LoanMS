using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class CibilReportDetailDto
{
    public int Id { get; set; }
    public string? BureauProvider { get; set; }
    public string? ControlNumber { get; set; }
    
    // Score Information
    public CibilScoreDto CreditScore { get; set; } = new();
    
    // Customer Profile
    public CibilCustomerProfileDto CustomerProfile { get; set; } = new();
    
    // Account Summary
    public CibilAccountSummaryDto AccountSummary { get; set; } = new();
    
    // Accounts List
    public List<CibilAccountDto> Accounts { get; set; } = new();
    
    // Payment History
    public CibilPaymentHistoryDto PaymentHistory { get; set; } = new();
    
    // Behaviour Analysis
    public CibilBehaviourAnalysisDto BehaviourAnalysis { get; set; } = new();
    
    // Enquiry Analysis
    public CibilEnquiryAnalysisDto EnquiryAnalysis { get; set; } = new();
    
    // Risk Analysis
    public CibilRiskAnalysisDto RiskAnalysis { get; set; } = new();
    
    // Meta
    public DateTime GeneratedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
