using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations.Schema;
using System.Linq;

namespace LoanMS.Domain.Entities
{
    public class BureauReport
    {
        public int Id { get; set; }
        public int CustomerId { get; set; }
        public string BureauProvider { get; set; } = string.Empty;
        
        public int CreditScore { get; set; }
        public string RiskCategory { get; set; } = string.Empty;
        public DateTime ScoreGeneratedDate { get; set; }
        public bool IsLiveScore { get; set; }
        public bool EligibleForLoan { get; set; }
        
        public string RiskLevel { get; set; } = string.Empty;
        public int ApprovalProbability { get; set; }
        public string RiskGrade { get; set; } = string.Empty;
        public decimal BureauRiskScore { get; set; }
        public string LendingRecommendation { get; set; } = string.Empty;
        
        public string FullName { get; set; } = string.Empty;
        public DateTime DateOfBirth { get; set; }
        public string Gender { get; set; } = string.Empty;
        public string PAN { get; set; } = string.Empty;
        public string AadhaarNumber { get; set; } = string.Empty;
        public string CKYCNumber { get; set; } = string.Empty;
        
        // NEW: Report control/reference number from bureau provider
        public string ControlNumber { get; set; } = string.Empty;
        // NEW: Office/landline phone number
        public string OfficeNumber { get; set; } = string.Empty;
        
        public List<BureauMobileNumber> MobileNumbers { get; set; } = new();
        public List<BureauEmailAddress> EmailAddresses { get; set; } = new();
        public List<BureauAddress> Addresses { get; set; } = new();
        
        public List<BureauEmployment> EmploymentHistory { get; set; } = new();
        public string OccupationType { get; set; } = string.Empty;
        public decimal AnnualIncome { get; set; }
        
        public int TotalAccounts { get; set; }
        public int ActiveAccounts { get; set; }
        public int ClosedAccounts { get; set; }
        public decimal TotalSanctionAmount { get; set; }
        public decimal CurrentOutstanding { get; set; }
        public decimal OverdueAmount { get; set; }
        public int SecuredLoanCount { get; set; }
        public int UnsecuredLoanCount { get; set; }
        public DateTime OldestAccountDate { get; set; }
        public DateTime LatestAccountDate { get; set; }
        
        public int RepaymentDisciplineScore { get; set; }
        public int DelinquencyFrequency { get; set; }
        public int AccountAge { get; set; }
        public string CreditMaturity { get; set; } = string.Empty;
        public string LoanClosureBehaviour { get; set; } = string.Empty;
        
        public int EnquiryCount30Days { get; set; }
        public int EnquiryCount90Days { get; set; }
        public int EnquiryCount12Months { get; set; }
        public int EnquiryCount24Months { get; set; }
        public DateTime? MostRecentEnquiryDate { get; set; }   // NEW: most recent enquiry date
        
        public List<ScoreFactor> ScoreFactors { get; set; } = new();
        
        // Convenience properties for filtering by IsPositive field
        [NotMapped]
        public List<ScoreFactor> PositiveFactors =>
            ScoreFactors?.Where(f => f.IsPositive).ToList() ?? new List<ScoreFactor>();
        
        [NotMapped]
        public List<ScoreFactor> NegativeFactors =>
            ScoreFactors?.Where(f => !f.IsPositive).ToList() ?? new List<ScoreFactor>();
        
        public List<BureauAccount> Accounts { get; set; } = new();
        public List<BureauEnquiry> Enquiries { get; set; } = new();
        
        public DateTime CreatedAt { get; set; }
        public DateTime UpdatedAt { get; set; }
        public string SourceFile { get; set; } = string.Empty;
        public bool IsActive { get; set; }

        // Computed convenience property - flattens PaymentHistory from all Accounts
        [NotMapped]
        public List<BureauPaymentHistory> PaymentHistory =>
            Accounts?.SelectMany(a => a.PaymentHistory ?? new List<BureauPaymentHistory>()).ToList()
            ?? new List<BureauPaymentHistory>();
    }

    public class BureauAccount
    {
        public int Id { get; set; }
        public int BureauReportId { get; set; }
        
        public string LenderName { get; set; } = string.Empty;
        public string LoanType { get; set; } = string.Empty;
        public string Ownership { get; set; } = string.Empty;
        public string AccountNumber { get; set; } = string.Empty;
        public string AccountStatus { get; set; } = string.Empty;
        
        public DateTime OpenDate { get; set; }
        public DateTime? ClosedDate { get; set; }
        public DateTime ReportDate { get; set; }
        public DateTime? LastPaymentDate { get; set; }
        
        public decimal SanctionAmount { get; set; }
        public decimal CurrentBalance { get; set; }
        public decimal EMIAmount { get; set; }
        
        public int TenureMonths { get; set; }
        public int RemainingTenure { get; set; }
        
        public string PaymentFrequency { get; set; } = string.Empty;
        public int DaysOverdue { get; set; }
        
        public bool IsWrittenOff { get; set; }
        public bool IsSettled { get; set; }
        public bool HasDelinquency { get; set; }
        
        // Existing new fields
        public decimal TotalPaidAmount { get; set; }
        public string AssetClassification { get; set; } = string.Empty;
        
        // NEW: fields matching CRIF Highmark PDF report
        public decimal? SettlementAmount { get; set; }
        public decimal? WrittenOffPrincipalAmount { get; set; }
        public decimal? WrittenOffTotalAmount { get; set; }
        public decimal? ActualLastPayment { get; set; }
        public decimal? InterestRate { get; set; }
        public string Collateral { get; set; } = string.Empty;
        public string CollateralType { get; set; } = string.Empty;
        public string SuitFiledStatus { get; set; } = string.Empty;
        public decimal? CashLimit { get; set; }
        public DateTime? LastBankUpdate { get; set; }
        public string RepaymentTenure { get; set; } = string.Empty;
        
        public BureauReport BureauReport { get; set; } = null!;
        public List<BureauPaymentHistory> PaymentHistory { get; set; } = new();
    }

    public class BureauPaymentHistory
    {
        public int Id { get; set; }
        public int BureauAccountId { get; set; }
        public int BureauReportId { get; set; }
        
        public DateTime ReportMonth { get; set; }
        public string DPDStatus { get; set; } = string.Empty;
        public int DaysOverdue { get; set; }
        public string Status { get; set; } = string.Empty;
        public bool IsMissedPayment { get; set; }
        public bool IsWriteOff { get; set; }
        public bool IsSettlement { get; set; }
        
        public decimal ScheduledAmount { get; set; }
        public decimal PaidAmount { get; set; }
        
        public BureauAccount Account { get; set; } = null!;
    }

    public class BureauEnquiry
    {
        public int Id { get; set; }
        public int BureauReportId { get; set; }
        public DateTime EnquiryDate { get; set; }
        public string EnquiryType { get; set; } = string.Empty;
        public decimal RequestedAmount { get; set; }
        public string Purpose { get; set; } = string.Empty;
        // NEW: name of the lender/member who raised the enquiry
        public string MemberName { get; set; } = string.Empty;
        // NEW: ownership type (PRIMARY, JOINT, GUARANTOR etc.)
        public string OwnershipType { get; set; } = string.Empty;
        public BureauReport BureauReport { get; set; } = null!;
    }

    public class BureauAddress
    {
        public int Id { get; set; }
        public int BureauReportId { get; set; }
        public string AddressType { get; set; } = string.Empty;
        public string Street { get; set; } = string.Empty;
        public string City { get; set; } = string.Empty;
        public string State { get; set; } = string.Empty;
        public string PostalCode { get; set; } = string.Empty;
        public string Country { get; set; } = string.Empty;
        public DateTime? DateReported { get; set; }
        public BureauReport BureauReport { get; set; } = null!;
    }

    public class BureauEmployment
    {
        public int Id { get; set; }
        public int BureauReportId { get; set; }
        public string EmployerName { get; set; } = string.Empty;
        public string Occupation { get; set; } = string.Empty;
        public string EmploymentType { get; set; } = string.Empty;
        public DateTime? EmploymentStartDate { get; set; }
        public DateTime? EmploymentEndDate { get; set; }
        public decimal MonthlyIncome { get; set; }
        public BureauReport BureauReport { get; set; } = null!;
    }

    public class BureauMobileNumber
    {
        public int Id { get; set; }
        public int BureauReportId { get; set; }
        public string PhoneNumber { get; set; } = string.Empty;
        public BureauReport BureauReport { get; set; } = null!;
    }

    public class BureauEmailAddress
    {
        public int Id { get; set; }
        public int BureauReportId { get; set; }
        public string EmailAddress { get; set; } = string.Empty;
        public BureauReport BureauReport { get; set; } = null!;
    }

    public class ScoreFactor
    {
        public int Id { get; set; }
        public int BureauReportId { get; set; }
        public string Factor { get; set; } = string.Empty;
        public int ImpactScore { get; set; }
        public bool IsPositive { get; set; }
        public string Description { get; set; } = string.Empty;
        public BureauReport BureauReport { get; set; } = null!;
    }
}
