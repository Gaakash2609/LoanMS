using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs;

public class BureauReportDetailDto
{
    public int Id { get; set; }
    public string? BureauProvider { get; set; }
    
    // Score Information
    public CreditScoreDto CreditScore { get; set; } = new();
    
    // Customer Profile
    public CustomerProfileDto CustomerProfile { get; set; } = new();
    
    // Account Summary
    public AccountSummaryDto AccountSummary { get; set; } = new();
    
    // Accounts List
    public List<BureauAccountDto> Accounts { get; set; } = new();
    
    // Payment History
    public PaymentHistoryDto PaymentHistory { get; set; } = new();
    
    // Behaviour Analysis
    public BehaviourAnalysisDto BehaviourAnalysis { get; set; } = new();
    
    // Enquiry Analysis
    public EnquiryAnalysisDto EnquiryAnalysis { get; set; } = new();
    
    // Risk Analysis
    public RiskAnalysisDto RiskAnalysis { get; set; } = new();
    
    // Meta
    public DateTime GeneratedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}
