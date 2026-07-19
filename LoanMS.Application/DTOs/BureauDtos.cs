using System;
using System.Collections.Generic;

namespace LoanMS.Application.DTOs
{
    // ===== REQUEST DTOs =====
    
    public class BureauUploadRequestDto
    {
        public int CustomerId { get; set; }
        public string? BureauProvider { get; set; } // CIBIL, Equifax, etc.
        public string? RawFileContent { get; set; } // XML/JSON from bureau
        public DateTime FileDate { get; set; }
    }

    public class BureauParseRequestDto
    {
        public string? RawContent { get; set; }
        public string? Format { get; set; } // XML, JSON, PDF
    }

    // ===== RESPONSE DTOs =====

    public class BureauReportSummaryDto
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

    // --- Credit Score Section ---
    
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

    public class ScoreFactorDto
    {
        public string? Factor { get; set; }
        public int ImpactScore { get; set; }
        public string? Description { get; set; }
    }

    // --- Customer Profile Section ---
    
    public class CustomerProfileDto
    {
        public string? FullName { get; set; }
        public DateTime DateOfBirth { get; set; }
        public string? Gender { get; set; }
        public string? PAN { get; set; }
        public string? AadhaarMasked { get; set; } // Masked
        public string? CKYCNumber { get; set; }
        
        public List<string> MobileNumbers { get; set; } = new();
        public List<string> EmailAddresses { get; set; } = new();
        public List<AddressDto> Addresses { get; set; } = new();
        
        public List<EmploymentDto> EmploymentHistory { get; set; } = new();
        public string? OccupationType { get; set; }
        public decimal AnnualIncome { get; set; }
    }

    public class AddressDto
    {
        public string? Type { get; set; }
        public string? Street { get; set; }
        public string? City { get; set; }
        public string? State { get; set; }
        public string? PostalCode { get; set; }
        public string? Country { get; set; }
        public DateTime? DateReported { get; set; }
    }

    public class EmploymentDto
    {
        public string? EmployerName { get; set; }
        public string? Occupation { get; set; }
        public string? EmploymentType { get; set; }
        public DateTime? StartDate { get; set; }
        public DateTime? EndDate { get; set; }
        public decimal MonthlyIncome { get; set; }
    }

    // --- Account Summary Section ---
    
    public class AccountSummaryDto
    {
        public int TotalAccounts { get; set; }
        public int ActiveAccounts { get; set; }
        public int ClosedAccounts { get; set; }
        
        public decimal TotalSanctionAmount { get; set; }
        public decimal CurrentOutstanding { get; set; }
        public decimal OverdueAmount { get; set; }
        
        public DateTime OldestAccountDate { get; set; }
        public DateTime LatestAccountDate { get; set; }
        
        public int SecuredLoanCount { get; set; }
        public int UnsecuredLoanCount { get; set; }
        
        public int AccountAgeMonths { get; set; }
    }

    // --- Loan Accounts Section ---
    
    public class BureauAccountDto
    {
        public int Id { get; set; }
        
        public string? LenderName { get; set; }
        public string? LoanType { get; set; }
        public string? Ownership { get; set; }
        public string? AccountNumberMasked { get; set; }
        
        public DateTime OpenDate { get; set; }
        public DateTime? ClosedDate { get; set; }
        public DateTime ReportDate { get; set; }
        public DateTime? LastPaymentDate { get; set; }
        
        public decimal SanctionAmount { get; set; }
        public decimal CurrentBalance { get; set; }
        public decimal EMIAmount { get; set; }
        
        public int TenureMonths { get; set; }
        public int RemainingTenure { get; set; }
        
        public string? PaymentFrequency { get; set; }
        public string? AccountStatus { get; set; }
        public int CurrentDPD { get; set; }
        
        public bool IsWrittenOff { get; set; }
        public bool IsSettled { get; set; }
    }

    // --- Payment History Section ---
    
    public class PaymentHistoryDto
    {
        public List<MonthlyPaymentStatusDto> Monthly { get; set; } = new();
        public DPDHeatmapDto DPDHeatmap { get; set; } = new();
        public DelinquencyTrackerDto DelinquencyTracker { get; set; } = new();
        public List<string> MissedPaymentAlerts { get; set; } = new();
    }

    public class MonthlyPaymentStatusDto
    {
        public DateTime ReportMonth { get; set; }
        public string? DPDStatus { get; set; } // 000, 030, 060, 090, 120+, WO, SO
        public int DaysOverdue { get; set; }
        public bool IsMissedPayment { get; set; }
        public bool IsWriteOff { get; set; }
        public bool IsSettlement { get; set; }
    }

    public class DPDHeatmapDto
    {
        public int Last3MonthsDPD { get; set; }
        public int Last6MonthsDPD { get; set; }
        public int Last12MonthsDPD { get; set; }
        public string? HealthStatus { get; set; } // Green, Yellow, Red
    }

    public class DelinquencyTrackerDto
    {
        public int TotalMissedPayments { get; set; }
        public int DelinquencyFrequency { get; set; }
        public int MaxDPDObserved { get; set; }
        public string? Pattern { get; set; } // Isolated, Frequent, Recent, None
    }

    // --- Behaviour Analysis Section ---
    
    public class BehaviourAnalysisDto
    {
        public int RepaymentDisciplineScore { get; set; } // 0-100
        public string? RepaymentDisciplineLevel { get; set; }
        
        public int DelinquencyFrequency { get; set; }
        public string? DelinquencyPattern { get; set; }
        
        public int AccountAgeMonths { get; set; }
        public string? CreditMaturity { get; set; } // New, Young, Mature
        
        public string? LoanClosureBehaviour { get; set; }
        public List<string> AutoGeneratedInsights { get; set; } = new();
    }

    // --- Enquiry Analysis Section ---
    
    public class EnquiryAnalysisDto
    {
        public int Count30Days { get; set; }
        public int Count90Days { get; set; }
        public int Count12Months { get; set; }
        public int Count24Months { get; set; }
        
        public bool HighEnquiryFrequency { get; set; }
        public bool LoanShoppingDetected { get; set; }
        public bool CreditHungryCustomer { get; set; }
        
        public List<EnquiryDto> EnquiryDetails { get; set; } = new();
    }

    public class EnquiryDto
    {
        public DateTime EnquiryDate { get; set; }
        public string? EnquiryType { get; set; }
        public decimal RequestedAmount { get; set; }
        public string? Purpose { get; set; }
    }

    // --- Risk Analysis Section ---
    
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

    public class RiskFactorDto
    {
        public string? Factor { get; set; }
        public string? Impact { get; set; } // Positive, Negative, Neutral
        public int Weight { get; set; } // 0-100
        public string? Description { get; set; }
    }

    // --- PDF Export ---
    
    public class BureauPDFExportRequestDto
    {
        public int BureauReportId { get; set; }
        public bool IncludeAccountDetails { get; set; } = true;
        public bool IncludePaymentHistory { get; set; } = true;
        public bool IncludeRiskAnalysis { get; set; } = true;
    }
}
