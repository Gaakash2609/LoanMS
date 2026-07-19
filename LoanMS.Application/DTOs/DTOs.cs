using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

// ══════════════════════════════════════════════════════════════════════════════
// AUTH DTOs
// ══════════════════════════════════════════════════════════════════════════════

public class LoginRequestDto
{
    [Required] [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required] [MinLength(6)]
    public string Password { get; set; } = string.Empty;
}

public class LoginResponseDto
{
    public string AccessToken { get; set; } = string.Empty;
    public string RefreshToken { get; set; } = string.Empty;
    public DateTime ExpiresAt { get; set; }
    public UserDto User { get; set; } = null!;
}

public class RefreshTokenRequestDto
{
    [Required] public string RefreshToken { get; set; } = string.Empty;
}

// ══════════════════════════════════════════════════════════════════════════════
// USER DTOs
// ══════════════════════════════════════════════════════════════════════════════

public class UserDto
{
    public int Id { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class CreateUserRequestDto
{
    [Required] public string FullName { get; set; } = string.Empty;
    [Required] [EmailAddress] public string Email { get; set; } = string.Empty;
    [Required] [MinLength(6)] public string Password { get; set; } = string.Empty;
    [Required] public UserRole Role { get; set; }
}

public class UpdateUserRequestDto
{
    [Required] public string FullName { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    public UserRole Role { get; set; }
}

public class ChangePasswordRequestDto
{
    [Required] public string CurrentPassword { get; set; } = string.Empty;
    [Required] [MinLength(6)] public string NewPassword { get; set; } = string.Empty;
}

// ══════════════════════════════════════════════════════════════════════════════
// CUSTOMER DTOs
// ══════════════════════════════════════════════════════════════════════════════

public class CustomerDto
{
    public int Id { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string? PanNumber { get; set; }
    public string? AadhaarNumber { get; set; }
    public DateTime? DateOfBirth { get; set; }
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? PinCode { get; set; }
    public decimal? MonthlyIncome { get; set; }
    public string? EmploymentType { get; set; }
    public string? CompanyName { get; set; }
    public int? CibilScore { get; set; }
    public int TotalLoans { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class CreateCustomerRequestDto
{
    [Required] public string FullName { get; set; } = string.Empty;
    [Required] [EmailAddress] public string Email { get; set; } = string.Empty;
    [Required] [Phone] public string Phone { get; set; } = string.Empty;
    public string? PanNumber { get; set; }
    public string? AadhaarNumber { get; set; }
    public DateTime? DateOfBirth { get; set; }
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? PinCode { get; set; }
    public decimal? MonthlyIncome { get; set; }
    public string? EmploymentType { get; set; }
    public string? CompanyName { get; set; }
    public int? CibilScore { get; set; }
}

public class UpdateCustomerRequestDto : CreateCustomerRequestDto { }

// ══════════════════════════════════════════════════════════════════════════════
// LOAN DTOs
// ══════════════════════════════════════════════════════════════════════════════

public class LoanDto
{
    public int Id { get; set; }
    public string LoanNumber { get; set; } = string.Empty;
    public string LoanType { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public decimal RequestedAmount { get; set; }
    public decimal? ApprovedAmount { get; set; }
    public decimal InterestRate { get; set; }
    public int TenureMonths { get; set; }
    public decimal? MonthlyEmi { get; set; }
    public string? Purpose { get; set; }
    public string? Remarks { get; set; }
    public DateTime? ApprovedAt { get; set; }
    public DateTime? DisbursedAt { get; set; }
    public CustomerDto Customer { get; set; } = null!;
    public UserDto CreatedBy { get; set; } = null!;
    public UserDto? AssignedTo { get; set; }
    public DateTime CreatedAt { get; set; }
    public List<LoanStatusHistoryDto> StatusHistory { get; set; } = new();
}

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
    public DateTime CreatedAt { get; set; }
}

public class CreateLoanRequestDto
{
    [Required] public int CustomerId { get; set; }
    [Required] public LoanType LoanType { get; set; }
    [Required] [Range(1000, 100000000)] public decimal RequestedAmount { get; set; }
    [Required] [Range(0.1, 100)] public decimal InterestRate { get; set; }
    [Required] [Range(1, 360)] public int TenureMonths { get; set; }
    public string? Purpose { get; set; }
    public string? Remarks { get; set; }
    public int? AssignedToUserId { get; set; }
}

public class UpdateLoanRequestDto
{
    public LoanType LoanType { get; set; }
    [Range(1000, 100000000)] public decimal RequestedAmount { get; set; }
    [Range(0.1, 100)] public decimal InterestRate { get; set; }
    [Range(1, 360)] public int TenureMonths { get; set; }
    public string? Purpose { get; set; }
    public string? Remarks { get; set; }
    public int? AssignedToUserId { get; set; }
}

public class UpdateLoanStatusRequestDto
{
    [Required] public LoanStatus NewStatus { get; set; }
    public decimal? ApprovedAmount { get; set; }
    public string? Comment { get; set; }
}

public class LoanStatusHistoryDto
{
    public int Id { get; set; }
    public string FromStatus { get; set; } = string.Empty;
    public string ToStatus { get; set; } = string.Empty;
    public string? Comment { get; set; }
    public string ChangedBy { get; set; } = string.Empty;
    public DateTime ChangedAt { get; set; }
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMON DTOs
// ══════════════════════════════════════════════════════════════════════════════

public class PagedResultDto<T>
{
    public List<T> Items { get; set; } = new();
    public int TotalCount { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
    public int TotalPages => (int)Math.Ceiling((double)TotalCount / PageSize);
    public bool HasNext => Page < TotalPages;
    public bool HasPrev => Page > 1;
}

public class ApiResponseDto<T>
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public T? Data { get; set; }
    public List<string> Errors { get; set; } = new();

    public static ApiResponseDto<T> Ok(T data, string? message = null) =>
        new() { Success = true, Data = data, Message = message };

    public static ApiResponseDto<T> Fail(string error) =>
        new() { Success = false, Errors = new List<string> { error } };

    public static ApiResponseDto<T> Fail(List<string> errors) =>
        new() { Success = false, Errors = errors };
}

public class DashboardStatsDto
{
    public int TotalLoans { get; set; }
    public int TotalCustomers { get; set; }
    public int PendingLoans { get; set; }
    public int ApprovedLoans { get; set; }
    public int RejectedLoans { get; set; }
    public int DisbursedLoans { get; set; }
    public decimal TotalRequestedAmount { get; set; }
    public decimal TotalApprovedAmount { get; set; }
    public decimal TotalDisbursedAmount { get; set; }
    public List<LoanListDto> RecentLoans { get; set; } = new();
}

public class LoanFilterDto
{
    public int Page { get; set; } = 1;
    public int PageSize { get; set; } = 10;
    public string? Search { get; set; }
    public LoanStatus? Status { get; set; }
    public LoanType? LoanType { get; set; }
    public int? CustomerId { get; set; }
    public int? AssignedToUserId { get; set; }
    public DateTime? FromDate { get; set; }
    public DateTime? ToDate { get; set; }
    public string SortBy { get; set; } = "CreatedAt";
    public string SortDir { get; set; } = "desc";
}


// ══════════════════════════════════════════════════════════════════════════════
// WIZARD SUBMIT — Full application from frontend wizard
// ══════════════════════════════════════════════════════════════════════════════

public class WizardSubmitDto
{
    // When set, identifies an existing Draft loan to resume/complete instead of
    // creating a brand-new Loan/Customer record. Leave null/0 for a fresh application.
    public int?    LoanId      { get; set; }
    public string FullName     { get; set; } = string.Empty;
    public string Mobile       { get; set; } = string.Empty;
    public string Email        { get; set; } = string.Empty;
    public string? Pan         { get; set; }
    public string? Aadhar      { get; set; }
    public string? Dob         { get; set; }
    public string? Gender      { get; set; }
    public int?   Cibil        { get; set; }
    public string? City        { get; set; }
    public string? State       { get; set; }
    public string? Street1     { get; set; }
    public string? Zip         { get; set; }
    public string? HomeType    { get; set; }
    public string? EmpType     { get; set; }
    public string? CompName    { get; set; }
    public string? CompType    { get; set; }
    public decimal Salary      { get; set; }
    public string? Desig       { get; set; }
    public string? OfficeEmail { get; set; }
    public string  LoanType    { get; set; } = "personal_loan";
    public decimal Amount      { get; set; }
    public decimal LoanRate    { get; set; } = 12;
    public int     Tenure      { get; set; } = 24;
    public string? Purpose     { get; set; }
    public string? R1Name      { get; set; }
    public string? R1Mobile    { get; set; }
    public string? R1Relation  { get; set; }
    public string? R2Name      { get; set; }
    public string? R2Mobile    { get; set; }
    public string? R2Relation  { get; set; }
    public string? SalesPerson { get; set; }
    public string? Source      { get; set; }
    public string? Channel     { get; set; }
    public string? LenderName  { get; set; }
    public string? EfinId      { get; set; }
}

public class WizardSubmitResponseDto
{
    public string  EfinId      { get; set; } = string.Empty;
    public int     LoanId      { get; set; }
    public int     CustomerId  { get; set; }
    public string  LoanNumber  { get; set; } = string.Empty;
    public decimal MonthlyEmi  { get; set; }
    public string  Status      { get; set; } = "Submitted";
}

// ══════════════════════════════════════════════════════════════════════════════
// PAYOUT RULES
// ══════════════════════════════════════════════════════════════════════════════

public class PayoutRuleDto
{
    public int     Id          { get; set; }
    public string  LoanType    { get; set; } = string.Empty;
    public decimal Percentage  { get; set; }
    public decimal? MinAmount  { get; set; }
    public decimal? MaxAmount  { get; set; }
    public string? Notes       { get; set; }
}

public class PayoutAutoCalcDto
{
    public int     LoanId      { get; set; }
    public decimal LoanAmount  { get; set; }
    public string  LoanType    { get; set; } = string.Empty;
    public decimal PayoutRate  { get; set; }
    public decimal PayoutAmount { get; set; }
    public string  Formula     { get; set; } = string.Empty;
}

// ══════════════════════════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════════════════════════

public class MonthlyReportDto
{
    public string  Month          { get; set; } = string.Empty;
    public int     TotalApps      { get; set; }
    public int     Approved       { get; set; }
    public int     Rejected       { get; set; }
    public int     Disbursed      { get; set; }
    public decimal TotalAmount    { get; set; }
    public decimal DisbursedAmt   { get; set; }
    public decimal ConversionRate { get; set; }
}

// ══════════════════════════════════════════════════════════════════════════════
// CIBIL / CREDIT BUREAU REPORT
// ══════════════════════════════════════════════════════════════════════════════

// ─── Quick Check Response ───

public class CibilCheckResponseDto
{
    public string Pan         { get; set; } = string.Empty;
    public int?   CibilScore  { get; set; }
    public string Status      { get; set; } = string.Empty;
    public string? Message    { get; set; }
    public bool   IsEligible  { get; set; }
    public string Source      { get; set; } = "Bureau";
}

// ─── Full Report Request/Response ───

public class CibilReportUploadRequestDto
{
    public int CustomerId { get; set; }
    public string? BureauProvider { get; set; } // CIBIL, Equifax, etc.
    public string? RawFileContent { get; set; } // XML/JSON from bureau
    public DateTime FileDate { get; set; }
}

public class CibilReportParseRequestDto
{
    public string? RawContent { get; set; }
    public string? Format { get; set; } // XML, JSON, PDF
}

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

// ─── Credit Score Section ───

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

public class CibilScoreFactorDto
{
    public string? Factor { get; set; }
    public int ImpactScore { get; set; }
    public string? Description { get; set; }
}

// ─── Customer Profile Section ───

public class CibilCustomerProfileDto
{
    public string? FullName { get; set; }
    public DateTime DateOfBirth { get; set; }
    public string? Gender { get; set; }
    public string? PAN { get; set; }
    public string? AadhaarMasked { get; set; }
    public string? CKYCNumber { get; set; }
    public string? ControlNumber { get; set; }
    
    public List<string> MobileNumbers { get; set; } = new();
    public string? OfficeNumber { get; set; }
    public List<string> EmailAddresses { get; set; } = new();
    public List<CibilAddressDto> Addresses { get; set; } = new();
    public List<CibilEmploymentDto> EmploymentHistory { get; set; } = new();
    public string? OccupationType { get; set; }
    public decimal AnnualIncome { get; set; }
}

public class CibilAddressDto
{
    public string? Type { get; set; }
    public string? Street { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? PostalCode { get; set; }
    public string? Country { get; set; }
    public DateTime? DateReported { get; set; }
}

public class CibilEmploymentDto
{
    public string? EmployerName { get; set; }
    public string? Occupation { get; set; }
    public string? EmploymentType { get; set; }
    public DateTime? StartDate { get; set; }
    public DateTime? EndDate { get; set; }
    public decimal MonthlyIncome { get; set; }
}

// ─── Account Summary Section ───

public class CibilAccountSummaryDto
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

// ─── Loan Accounts Section ───

public class CibilAccountDto
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
    public DateTime? LastBankUpdate { get; set; }          // CRIF: Last Bank Update date
    
    public decimal SanctionAmount { get; set; }
    public decimal CurrentBalance { get; set; }
    public decimal EMIAmount { get; set; }
    public decimal TotalPaidAmount { get; set; }
    
    public int TenureMonths { get; set; }
    public int RemainingTenure { get; set; }
    public string? RepaymentTenure { get; set; }           // CRIF: e.g. "3 years 8 months"
    
    // CRIF: full account detail fields (PDF page 5-6)
    public decimal? SettlementAmount { get; set; }
    public decimal? WrittenOffPrincipalAmount { get; set; }
    public decimal? WrittenOffTotalAmount { get; set; }
    public decimal? ActualLastPayment { get; set; }
    public decimal? InterestRate { get; set; }
    public string? Collateral { get; set; }
    public string? CollateralType { get; set; }
    public string? SuitFiledStatus { get; set; }
    public decimal? CashLimit { get; set; }
    
    public string? PaymentFrequency { get; set; }
    public string? AccountStatus { get; set; }
    public int CurrentDPD { get; set; }
    public string? AssetClassification { get; set; }
    
    public bool IsWrittenOff { get; set; }
    public bool IsSettled { get; set; }
    public List<CibilMonthlyPaymentStatusDto> PaymentHistory { get; set; } = new();
}

// ─── Payment History Section ───

public class CibilPaymentHistoryDto
{
    public List<CibilMonthlyPaymentStatusDto> Monthly { get; set; } = new();
    public CibilDPDHeatmapDto DPDHeatmap { get; set; } = new();
    public CibilDelinquencyTrackerDto DelinquencyTracker { get; set; } = new();
    public List<string> MissedPaymentAlerts { get; set; } = new();
}

public class CibilMonthlyPaymentStatusDto
{
    public DateTime ReportMonth { get; set; }
    public string? DPDStatus { get; set; } // 000, 030, 060, 090, 120+, WO, SO
    public int DaysOverdue { get; set; }
    public bool IsMissedPayment { get; set; }
    public bool IsWriteOff { get; set; }
    public bool IsSettlement { get; set; }
    // NEW: scheduled and actual paid amounts for payment history detail
    public decimal ScheduledAmount { get; set; }
    public decimal PaidAmount { get; set; }
}

public class CibilDPDHeatmapDto
{
    public int Last3MonthsDPD { get; set; }
    public int Last6MonthsDPD { get; set; }
    public int Last12MonthsDPD { get; set; }
    public string? HealthStatus { get; set; } // Green, Yellow, Red
}

public class CibilDelinquencyTrackerDto
{
    public int TotalMissedPayments { get; set; }
    public int DelinquencyFrequency { get; set; }
    public int MaxDPDObserved { get; set; }
    public string? Pattern { get; set; } // Isolated, Frequent, Recent, None
}

// ─── Behaviour Analysis Section ───

public class CibilBehaviourAnalysisDto
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

// ─── Enquiry Analysis Section ───

public class CibilEnquiryAnalysisDto
{
    public int Count30Days { get; set; }
    public int Count90Days { get; set; }
    public int Count12Months { get; set; }
    public int Count24Months { get; set; }
    // NEW: date of most recent enquiry
    public DateTime? MostRecentEnquiryDate { get; set; }
    
    public bool HighEnquiryFrequency { get; set; }
    public bool LoanShoppingDetected { get; set; }
    public bool CreditHungryCustomer { get; set; }
    
    public List<CibilEnquiryDto> EnquiryDetails { get; set; } = new();
}

public class CibilEnquiryDto
{
    public DateTime EnquiryDate { get; set; }
    public string? EnquiryType { get; set; }
    public decimal RequestedAmount { get; set; }
    public string? Purpose { get; set; }
    public string? MemberName { get; set; }
    public string? OwnershipType { get; set; }
}

// ─── Risk Analysis Section ───

public class CibilRiskAnalysisDto
{
    public string? RiskLevel { get; set; } // Low, Medium, High
    public string? RiskGrade { get; set; } // A, B, C, D, E
    public decimal BureauRiskScore { get; set; } // 0-100
    
    public int ApprovalProbability { get; set; } // 0-100%
    public string? LendingRecommendation { get; set; } // Approve, Review, Reject
    
    public List<CibilRiskFactorDto> RiskFactors { get; set; } = new();
    public List<string> RiskWarnings { get; set; } = new();
    public List<string> Recommendations { get; set; } = new();
}

public class CibilRiskFactorDto
{
    public string? Factor { get; set; }
    public string? Impact { get; set; } // Positive, Negative, Neutral
    public int Weight { get; set; } // 0-100
    public string? Description { get; set; }
}

// ─── PDF Export ───

public class CibilPDFExportRequestDto
{
    public int CibilReportId { get; set; }
    public bool IncludeAccountDetails { get; set; } = true;
    public bool IncludePaymentHistory { get; set; } = true;
    public bool IncludeRiskAnalysis { get; set; } = true;
}

// ══════════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════════════════════════════════════

public class AuditLogDto
{
    public int    Id         { get; set; }
    public string EntityName { get; set; } = string.Empty;
    public string Action     { get; set; } = string.Empty;
    public string? EntityId  { get; set; }
    public string? UserName  { get; set; }
    public string? OldValues { get; set; }
    public string? NewValues { get; set; }
    public DateTime CreatedAt { get; set; }
}

// ══════════════════════════════════════════════════════════════════════════════
// PASSWORD RESET DTOs
// ══════════════════════════════════════════════════════════════════════════════

public class ForgotPasswordRequestDto
{
    [Required] [EmailAddress]
    public string Email { get; set; } = string.Empty;
}

public class ResetPasswordRequestDto
{
    [Required] public string Token { get; set; } = string.Empty;

    [Required] [EmailAddress]
    public string Email { get; set; } = string.Empty;

    [Required] [MinLength(8)]
    public string NewPassword { get; set; } = string.Empty;

    [Required] [Compare(nameof(NewPassword), ErrorMessage = "Passwords do not match.")]
    public string ConfirmPassword { get; set; } = string.Empty;
}
