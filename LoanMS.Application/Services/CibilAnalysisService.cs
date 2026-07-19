using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using LoanMS.Domain.Entities;
using LoanMS.Application.DTOs;

namespace LoanMS.Application.Services
{
    public interface ICibilAnalysisService
    {
        Task<CibilReportDetailDto> AnalyzeCibilReport(BureauReport report);
        Task<CibilRiskAnalysisDto> CalculateRiskAnalysis(BureauReport report);
        Task<CibilBehaviourAnalysisDto> AnalyzeCreditBehaviour(BureauReport report);
        Task<CibilEnquiryAnalysisDto> AnalyzeEnquiries(BureauReport report);
        Task<List<string>> GenerateAutoInsights(BureauReport report);
    }

    public class CibilAnalysisService : ICibilAnalysisService
    {
        // Score Ranges
        private const int EXCELLENT_MIN = 750;
        private const int GOOD_MIN = 650;
        private const int FAIR_MIN = 550;
        private const int POOR_MIN = 300;

        public async Task<CibilReportDetailDto> AnalyzeCibilReport(BureauReport report)
        {
            var dto = new CibilReportDetailDto
            {
                Id = report.Id,
                BureauProvider = report.BureauProvider,
                // NEW: map control number
                ControlNumber = report.ControlNumber,
                GeneratedAt = report.ScoreGeneratedDate,
                UpdatedAt = report.UpdatedAt,

                // Credit Score
                CreditScore = new CibilScoreDto
                {
                    Score = report.CreditScore,
                    MaxScore = 900,
                    MinScore = 300,
                    Category = GetRiskCategory(report.CreditScore),
                    IsLiveScore = report.IsLiveScore,
                    EligibleForLoan = report.EligibleForLoan,
                    GeneratedDate = report.ScoreGeneratedDate,
                    GeneratedTime = report.ScoreGeneratedDate.ToString("hh:mm tt"),
                    PositiveFactors = report.PositiveFactors?.Select(f => new CibilScoreFactorDto
                    {
                        Factor = f.Factor,
                        ImpactScore = f.ImpactScore,
                        Description = f.Description
                    }).ToList() ?? new List<CibilScoreFactorDto>(),
                    NegativeFactors = report.NegativeFactors?.Select(f => new CibilScoreFactorDto
                    {
                        Factor = f.Factor,
                        ImpactScore = f.ImpactScore,
                        Description = f.Description
                    }).ToList() ?? new List<CibilScoreFactorDto>()
                },

                // Customer Profile
                CustomerProfile = new CibilCustomerProfileDto
                {
                    FullName = report.FullName,
                    DateOfBirth = report.DateOfBirth,
                    Gender = report.Gender,
                    PAN = MaskPAN(report.PAN),
                    AadhaarMasked = MaskAadhaar(report.AadhaarNumber),
                    CKYCNumber = report.CKYCNumber,
                    // NEW: control number and office number
                    ControlNumber = report.ControlNumber,
                    OfficeNumber = report.OfficeNumber,
                    MobileNumbers = report.MobileNumbers?.Select(m => m.PhoneNumber).ToList() ?? new List<string>(),
                    EmailAddresses = report.EmailAddresses?.Select(e => e.EmailAddress).ToList() ?? new List<string>(),
                    Addresses = report.Addresses?.Select(a => new CibilAddressDto
                    {
                        Type = a.AddressType,
                        Street = a.Street,
                        City = a.City,
                        State = a.State,
                        PostalCode = a.PostalCode,
                        Country = a.Country,
                        DateReported = a.DateReported
                    }).ToList() ?? new List<CibilAddressDto>(),
                    EmploymentHistory = report.EmploymentHistory?.Select(e => new CibilEmploymentDto
                    {
                        EmployerName = e.EmployerName,
                        Occupation = e.Occupation,
                        EmploymentType = e.EmploymentType,
                        StartDate = e.EmploymentStartDate,
                        EndDate = e.EmploymentEndDate,
                        MonthlyIncome = e.MonthlyIncome
                    }).ToList() ?? new List<CibilEmploymentDto>(),
                    OccupationType = report.OccupationType,
                    AnnualIncome = report.AnnualIncome
                },

                // Account Summary
                AccountSummary = new CibilAccountSummaryDto
                {
                    TotalAccounts = report.TotalAccounts,
                    ActiveAccounts = report.ActiveAccounts,
                    ClosedAccounts = report.ClosedAccounts,
                    TotalSanctionAmount = report.TotalSanctionAmount,
                    CurrentOutstanding = report.CurrentOutstanding,
                    OverdueAmount = report.OverdueAmount,
                    OldestAccountDate = report.OldestAccountDate,
                    LatestAccountDate = report.LatestAccountDate,
                    SecuredLoanCount = report.SecuredLoanCount,
                    UnsecuredLoanCount = report.UnsecuredLoanCount,
                    AccountAgeMonths = report.AccountAge
                },

                // Accounts — now includes all previously unmapped fields + new fields
                Accounts = report.Accounts?.Select(a => new CibilAccountDto
                {
                    Id = a.Id,
                    LenderName = a.LenderName,
                    LoanType = a.LoanType,
                    Ownership = a.Ownership,
                    AccountNumberMasked = MaskAccountNumber(a.AccountNumber),
                    OpenDate = a.OpenDate,
                    ClosedDate = a.ClosedDate,
                    ReportDate = a.ReportDate,
                    LastPaymentDate = a.LastPaymentDate,
                    SanctionAmount = a.SanctionAmount,
                    CurrentBalance = a.CurrentBalance,
                    EMIAmount = a.EMIAmount,
                    // Existing new fields
                    TotalPaidAmount = a.TotalPaidAmount,
                    TenureMonths = a.TenureMonths,
                    RemainingTenure = a.RemainingTenure,
                    // NEW: human-readable tenure e.g. "3 years 8 months"
                    RepaymentTenure = a.RepaymentTenure ?? FormatTenure(a.TenureMonths),
                    PaymentFrequency = a.PaymentFrequency,
                    AccountStatus = a.AccountStatus,
                    CurrentDPD = a.DaysOverdue,
                    AssetClassification = a.AssetClassification,
                    // NEW: CRIF account detail fields
                    SettlementAmount = a.SettlementAmount,
                    WrittenOffPrincipalAmount = a.WrittenOffPrincipalAmount,
                    WrittenOffTotalAmount = a.WrittenOffTotalAmount,
                    ActualLastPayment = a.ActualLastPayment,
                    InterestRate = a.InterestRate,
                    Collateral = a.Collateral,
                    CollateralType = a.CollateralType,
                    SuitFiledStatus = a.SuitFiledStatus,
                    CashLimit = a.CashLimit,
                    LastBankUpdate = a.LastBankUpdate,
                    IsWrittenOff = a.IsWrittenOff,
                    IsSettled = a.IsSettled,
                    // NEW: per-account payment history for DPD grid
                    PaymentHistory = a.PaymentHistory?.Select(ph => new CibilMonthlyPaymentStatusDto
                    {
                        ReportMonth = ph.ReportMonth,
                        DPDStatus = ph.DPDStatus,
                        DaysOverdue = ph.DaysOverdue,
                        IsMissedPayment = ph.IsMissedPayment,
                        IsWriteOff = ph.IsWriteOff,
                        IsSettlement = ph.IsSettlement,
                        ScheduledAmount = ph.ScheduledAmount,
                        PaidAmount = ph.PaidAmount
                    }).OrderBy(ph => ph.ReportMonth).ToList() ?? new List<CibilMonthlyPaymentStatusDto>()
                }).ToList() ?? new List<CibilAccountDto>(),

                // Payment History
                PaymentHistory = await AnalyzePaymentHistory(report),

                // Behaviour Analysis
                BehaviourAnalysis = await AnalyzeCreditBehaviour(report),

                // Enquiry Analysis
                EnquiryAnalysis = await AnalyzeEnquiries(report),

                // Risk Analysis
                RiskAnalysis = await CalculateRiskAnalysis(report)
            };

            return dto;
        }

        public async Task<CibilRiskAnalysisDto> CalculateRiskAnalysis(BureauReport report)
        {
            var riskScore = CalculateBureauRiskScore(report);
            var riskLevel = GetRiskLevel(riskScore);
            var riskGrade = GetRiskGrade(report.CreditScore, riskScore);
            var approvalProb = CalculateApprovalProbability(report);
            var recommendation = GetLendingRecommendation(approvalProb);

            var riskAnalysis = new CibilRiskAnalysisDto
            {
                RiskLevel = riskLevel,
                RiskGrade = riskGrade,
                BureauRiskScore = riskScore,
                ApprovalProbability = approvalProb,
                LendingRecommendation = recommendation,
                RiskFactors = GetRiskFactors(report),
                RiskWarnings = GetRiskWarnings(report),
                Recommendations = GetRecommendations(report)
            };

            return riskAnalysis;
        }

        public async Task<CibilBehaviourAnalysisDto> AnalyzeCreditBehaviour(BureauReport report)
        {
            var repaymentScore = CalculateRepaymentDisciplineScore(report);
            var delinquencyFreq = CalculateDelinquencyFrequency(report);
            var maturity = GetCreditMaturity(report.AccountAge);

            return new CibilBehaviourAnalysisDto
            {
                RepaymentDisciplineScore = repaymentScore,
                RepaymentDisciplineLevel = GetRepaymentLevel(repaymentScore),
                DelinquencyFrequency = delinquencyFreq,
                DelinquencyPattern = GetDelinquencyPattern(report),
                AccountAgeMonths = report.AccountAge,
                CreditMaturity = maturity,
                LoanClosureBehaviour = AnalyzeLoanClosureBehaviour(report),
                AutoGeneratedInsights = await GenerateAutoInsights(report)
            };
        }

        public async Task<CibilEnquiryAnalysisDto> AnalyzeEnquiries(BureauReport report)
        {
            var highFrequency = report.EnquiryCount30Days > 3 || report.EnquiryCount90Days > 5;
            var loanShopping = report.EnquiryCount90Days > 5;
            var creditHungry = report.EnquiryCount12Months > 10;

            return new CibilEnquiryAnalysisDto
            {
                Count30Days = report.EnquiryCount30Days,
                Count90Days = report.EnquiryCount90Days,
                Count12Months = report.EnquiryCount12Months,
                Count24Months = report.EnquiryCount24Months,
                // NEW: derive most recent enquiry date from enquiry list or entity field
                MostRecentEnquiryDate = report.MostRecentEnquiryDate
                    ?? report.Enquiries?.OrderByDescending(e => e.EnquiryDate).FirstOrDefault()?.EnquiryDate,
                HighEnquiryFrequency = highFrequency,
                LoanShoppingDetected = loanShopping,
                CreditHungryCustomer = creditHungry,
                EnquiryDetails = report.Enquiries?.Select(e => new CibilEnquiryDto
                {
                    EnquiryDate = e.EnquiryDate,
                    EnquiryType = e.EnquiryType,
                    RequestedAmount = e.RequestedAmount,
                    Purpose = e.Purpose,
                    // NEW
                    MemberName = e.MemberName,
                    OwnershipType = e.OwnershipType
                }).OrderByDescending(e => e.EnquiryDate).ToList() ?? new List<CibilEnquiryDto>()
            };
        }

        public async Task<List<string>> GenerateAutoInsights(BureauReport report)
        {
            var insights = new List<string>();

            // Score Insights
            if (report.CreditScore >= 750)
                insights.Add("Excellent credit score indicating strong repayment history.");
            else if (report.CreditScore < 550)
                insights.Add("Poor credit score. Recent improvement in repayment behaviour required.");

            // DPD Insights
            var maxDPD = report.PaymentHistory?.Max(p => p.DaysOverdue) ?? 0;
            if (maxDPD == 0)
                insights.Add("No delinquency observed. Consistent on-time payments.");
            else if (maxDPD > 90)
                insights.Add($"Significant delinquency observed ({maxDPD} DPD). Lender discretion advised.");
            else if (maxDPD > 60)
                insights.Add($"One {maxDPD} DPD observed. Recent repayment behaviour is satisfactory.");

            // Overdue Insights
            if (report.OverdueAmount > 0)
                insights.Add("Active overdue amount detected. May impact loan eligibility.");
            else
                insights.Add("No active overdue detected.");

            // Enquiry Insights
            if (report.EnquiryCount30Days > 3)
                insights.Add("High enquiry frequency in last 30 days. Indicates active loan shopping.");
            
            if (report.EnquiryCount12Months > 10)
                insights.Add("Customer appears credit-hungry with 10+ enquiries in last 12 months.");

            // Account Age Insights
            if (report.AccountAge < 6)
                insights.Add("Credit profile is relatively new. Limited historical data available.");
            else if (report.AccountAge > 24)
                insights.Add("Mature credit profile with adequate credit history.");

            // Secured vs Unsecured
            if (report.SecuredLoanCount > 0 && report.UnsecuredLoanCount == 0)
                insights.Add("Customer has only secured credit. Consider unsecured credit history.");

            return insights;
        }

        // ===== HELPER METHODS =====

        private string GetRiskCategory(int score)
        {
            return score switch
            {
                >= 750 => "Excellent",
                >= 650 => "Good",
                >= 550 => "Fair",
                >= 300 => "Poor",
                _ => "High Risk"
            };
        }

        private decimal CalculateBureauRiskScore(BureauReport report)
        {
            decimal risk = 50; // Base risk score

            // Score Factor (40 points)
            risk -= (report.CreditScore - 300) / 600m * 40;

            // DPD Factor (30 points)
            var maxDPD = report.PaymentHistory?.Max(p => p.DaysOverdue) ?? 0;
            if (maxDPD == 0)
                risk -= 30;
            else if (maxDPD < 30)
                risk -= 20;
            else if (maxDPD < 90)
                risk -= 10;

            // Overdue Factor (20 points)
            if (report.OverdueAmount == 0)
                risk -= 20;
            else if (report.OverdueAmount < report.CurrentOutstanding * 0.05m)
                risk -= 10;

            // Enquiry Factor (10 points)
            if (report.EnquiryCount30Days > 5 || report.EnquiryCount90Days > 10)
                risk += 10;
            else if (report.EnquiryCount30Days > 3)
                risk += 5;

            return Math.Max(0, Math.Min(100, risk));
        }

        private string GetRiskLevel(decimal score)
        {
            return score switch
            {
                < 30m => "Low",
                < 60m => "Medium",
                _ => "High"
            };
        }

        private string GetRiskGrade(int creditScore, decimal riskScore)
        {
            if (creditScore >= 750 && riskScore < 30m)
                return "A";
            else if (creditScore >= 650 && riskScore < 50m)
                return "B";
            else if (creditScore >= 550 && riskScore < 70m)
                return "C";
            else if (creditScore >= 300 && riskScore < 85m)
                return "D";
            else
                return "E";
        }

        private int CalculateApprovalProbability(BureauReport report)
        {
            int probability = 50;

            // Score Impact
            probability += (report.CreditScore - 550) / 4;

            // DPD Impact
            var maxDPD = report.PaymentHistory?.Max(p => p.DaysOverdue) ?? 0;
            probability -= (maxDPD / 30) * 5;

            // Enquiry Impact
            probability -= report.EnquiryCount30Days * 3;

            // Overdue Impact
            if (report.OverdueAmount > 0)
                probability -= 15;

            // Account Age Impact
            if (report.AccountAge < 6)
                probability -= 10;

            return Math.Max(0, Math.Min(100, probability));
        }

        private string GetLendingRecommendation(int approvalProb)
        {
            return approvalProb switch
            {
                > 75 => "Approve",
                > 50 => "Review",
                _ => "Reject"
            };
        }

        private int CalculateRepaymentDisciplineScore(BureauReport report)
        {
            int score = 50;

            var paymentHistory = report.PaymentHistory ?? new List<BureauPaymentHistory>();
            if (paymentHistory.Count == 0)
                return 50;

            var missedPayments = paymentHistory.Count(p => p.IsMissedPayment);
            var onTimePayments = paymentHistory.Count(p => p.DaysOverdue == 0);

            score = (onTimePayments * 100) / paymentHistory.Count;
            score -= (missedPayments * 10);

            return Math.Max(0, Math.Min(100, score));
        }

        private int CalculateDelinquencyFrequency(BureauReport report)
        {
            return report.PaymentHistory?.Count(p => p.DaysOverdue > 0) ?? 0;
        }

        private string GetCreditMaturity(int ageMonths)
        {
            return ageMonths switch
            {
                < 12 => "New",
                < 24 => "Young",
                _ => "Mature"
            };
        }

        private string GetRepaymentLevel(int score)
        {
            return score switch
            {
                >= 80 => "Excellent",
                >= 60 => "Good",
                >= 40 => "Fair",
                _ => "Poor"
            };
        }

        private string GetDelinquencyPattern(BureauReport report)
        {
            var paymentHistory = report.PaymentHistory?.OrderByDescending(p => p.ReportMonth).Take(6).ToList() ?? new List<BureauPaymentHistory>();
            
            if (paymentHistory.Count == 0)
                return "None";

            var recentDelq = paymentHistory.Count(p => p.DaysOverdue > 0);
            var totalDelq = report.PaymentHistory?.Count(p => p.DaysOverdue > 0) ?? 0;

            if (recentDelq > 0)
                return "Recent";
            else if (totalDelq > 3)
                return "Frequent";
            else if (totalDelq > 0)
                return "Isolated";
            else
                return "None";
        }

        private string AnalyzeLoanClosureBehaviour(BureauReport report)
        {
            var closedAccounts = report.Accounts?.Where(a => a.AccountStatus == "Closed").ToList() ?? new List<BureauAccount>();
            
            if (closedAccounts.Count == 0)
                return "No closed accounts";
            
            var cleanClosures = closedAccounts.Count(a => !a.IsWrittenOff && !a.IsSettled);
            var ratio = cleanClosures / (decimal)closedAccounts.Count;

            return ratio > 0.8m ? "Timely closures" : "Mixed closure behaviour";
        }

        private List<CibilRiskFactorDto> GetRiskFactors(BureauReport report)
        {
            var factors = new List<CibilRiskFactorDto>();

            // Credit Score
            factors.Add(new CibilRiskFactorDto
            {
                Factor = "Credit Score",
                Impact = report.CreditScore >= 650 ? "Positive" : "Negative",
                Weight = report.CreditScore >= 650 ? 20 : 50,
                Description = $"Score of {report.CreditScore} out of 900"
            });

            // Delinquency
            var maxDPD = report.PaymentHistory?.Max(p => p.DaysOverdue) ?? 0;
            factors.Add(new CibilRiskFactorDto
            {
                Factor = "Payment Delinquency",
                Impact = maxDPD == 0 ? "Positive" : "Negative",
                Weight = maxDPD == 0 ? 5 : Math.Min(maxDPD / 30, 30),
                Description = $"Max DPD: {maxDPD} days"
            });

            // Overdue
            factors.Add(new CibilRiskFactorDto
            {
                Factor = "Active Overdue",
                Impact = report.OverdueAmount == 0 ? "Positive" : "Negative",
                Weight = report.OverdueAmount == 0 ? 0 : 25,
                Description = $"Outstanding: ₹{report.OverdueAmount}"
            });

            // Enquiries
            factors.Add(new CibilRiskFactorDto
            {
                Factor = "Enquiry Frequency",
                Impact = report.EnquiryCount30Days <= 3 ? "Positive" : "Negative",
                Weight = Math.Min(report.EnquiryCount30Days * 3, 15),
                Description = $"{report.EnquiryCount30Days} enquiries in 30 days"
            });

            return factors;
        }

        private List<string> GetRiskWarnings(BureauReport report)
        {
            var warnings = new List<string>();

            if (report.CreditScore < 550)
                warnings.Add("Poor credit score indicates higher default risk.");

            if (report.OverdueAmount > 0)
                warnings.Add("Active overdue amount present. Immediate collection risk.");

            var maxDPD = report.PaymentHistory?.Max(p => p.DaysOverdue) ?? 0;
            if (maxDPD > 120)
                warnings.Add("Severe delinquency history. Exercise extreme caution.");

            if (report.EnquiryCount30Days > 5)
                warnings.Add("Multiple loan enquiries indicate credit stress.");

            if (report.Accounts?.Any(a => a.IsWrittenOff) ?? false)
                warnings.Add("Written-off accounts on record.");

            return warnings;
        }

        private List<string> GetRecommendations(BureauReport report)
        {
            var recommendations = new List<string>();

            if (report.ApprovalProbability > 75)
            {
                recommendations.Add("Customer qualifies for standard loan products.");
                recommendations.Add("Consider competitive pricing given low risk profile.");
            }
            else if (report.ApprovalProbability > 50)
            {
                recommendations.Add("Detailed credit assessment recommended.");
                recommendations.Add("Request additional documentation for verification.");
                recommendations.Add("Consider co-applicant or collateral.");
            }
            else
            {
                recommendations.Add("Recommend rejection or significant restrictions.");
                recommendations.Add("If approved, mandate strict monitoring.");
            }

            return recommendations;
        }

        private async Task<CibilPaymentHistoryDto> AnalyzePaymentHistory(BureauReport report)
        {
            var history = report.PaymentHistory?.OrderBy(p => p.ReportMonth).ToList() ?? new List<BureauPaymentHistory>();

            return new CibilPaymentHistoryDto
            {
                Monthly = history.Select(h => new CibilMonthlyPaymentStatusDto
                {
                    ReportMonth = h.ReportMonth,
                    DPDStatus = h.DPDStatus,
                    DaysOverdue = h.DaysOverdue,
                    IsMissedPayment = h.IsMissedPayment,
                    IsWriteOff = h.IsWriteOff,
                    IsSettlement = h.IsSettlement,
                    // NEW
                    ScheduledAmount = h.ScheduledAmount,
                    PaidAmount = h.PaidAmount
                }).ToList(),

                DPDHeatmap = new CibilDPDHeatmapDto
                {
                    Last3MonthsDPD = history.TakeLast(3).Max(h => (int?)h.DaysOverdue) ?? 0,
                    Last6MonthsDPD = history.TakeLast(6).Max(h => (int?)h.DaysOverdue) ?? 0,
                    Last12MonthsDPD = history.TakeLast(12).Max(h => (int?)h.DaysOverdue) ?? 0,
                    HealthStatus = history.TakeLast(3).Any(h => h.DaysOverdue > 0) ? "Red" : "Green"
                },

                DelinquencyTracker = new CibilDelinquencyTrackerDto
                {
                    TotalMissedPayments = history.Count(h => h.IsMissedPayment),
                    DelinquencyFrequency = history.Count(h => h.DaysOverdue > 0),
                    MaxDPDObserved = history.Max(h => (int?)h.DaysOverdue) ?? 0,
                    Pattern = GetDelinquencyPattern(report)
                },

                MissedPaymentAlerts = history
                    .Where(h => h.IsMissedPayment)
                    .Select(h => $"Missed payment in {h.ReportMonth:MMM yyyy}")
                    .ToList()
            };
        }

        // Format tenure months to human-readable string e.g. "3 years 8 months"
        private static string FormatTenure(int months)
        {
            if (months <= 0) return "—";
            var years = months / 12;
            var rem   = months % 12;
            if (years > 0 && rem > 0)  return $"{years} year{(years>1?"s":"")} {rem} month{(rem>1?"s":"")}";
            if (years > 0)             return $"{years} year{(years>1?"s":"")}";
            return $"{rem} month{(rem>1?"s":"")}";
        }

        private string MaskPAN(string pan)
        {
            if (string.IsNullOrEmpty(pan) || pan.Length < 4)
                return pan;
            return "XXXXX" + pan.Substring(pan.Length - 4);
        }

        private string MaskAadhaar(string aadhaar)
        {
            if (string.IsNullOrEmpty(aadhaar) || aadhaar.Length < 4)
                return aadhaar;
            return "XXXX XXXX " + aadhaar.Substring(aadhaar.Length - 4);
        }

        private string MaskAccountNumber(string accountNumber)
        {
            if (string.IsNullOrEmpty(accountNumber) || accountNumber.Length < 4)
                return accountNumber;
            return new string('*', accountNumber.Length - 4) + accountNumber.Substring(accountNumber.Length - 4);
        }
    }
}
