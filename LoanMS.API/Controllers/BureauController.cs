using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.Threading.Tasks;
using LoanMS.Application.DTOs;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;

namespace LoanMS.API.Controllers
{
    // PHASE 6 SECURITY FIX: this controller previously had no [Authorize] anywhere
    // (class or method level) and no global fallback authorization policy is
    // configured in Program.cs, so every bureau/credit-report endpoint here
    // (upload, credit-score, risk-analysis, payment-history, etc.) was reachable
    // by anyone with no login at all.
    //
    // RBAC decision (evidence: CustomersController/LoansController conventions):
    // - Class-level bare [Authorize] covers all read-only GET endpoints — same
    //   pattern CustomersController uses for day-to-day PII access by any
    //   authenticated role, including Sales, who need to view credit reports
    //   while processing a loan application.
    // - The one cost-bearing/controlled mutating action (UploadBureauFile,
    //   which triggers processing of an external CIBIL/Equifax pull) is
    //   restricted to Admin,Manager below — same restriction level
    //   LoansController/CustomersController apply to their comparably
    //   impactful mutating actions.
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class BureauController : ControllerBase
    {
        private readonly IBureauService _bureauService;
        private readonly IBureauAnalysisService _analysisService;

        public BureauController(IBureauService bureauService, IBureauAnalysisService analysisService)
        {
            _bureauService = bureauService;
            _analysisService = analysisService;
        }

        /// <summary>
        /// Upload bureau file (XML/JSON from CIBIL, Equifax, etc.)
        /// </summary>
        // PHASE 6 RBAC: triggering a bureau pull/upload is a controlled,
        // cost-bearing external-data action — restricted to Admin,Manager,
        // matching how LoansController/CustomersController restrict their
        // comparably impactful mutating actions. Read endpoints below stay at
        // the class-level bare [Authorize] (any authenticated user, including
        // Sales), matching CustomersController's convention for day-to-day
        // read access to customer/PII-adjacent data.
        [Authorize(Roles = "Admin,Manager")]
        [HttpPost("upload")]
        public async Task<IActionResult> UploadBureauFile([FromBody] BureauUploadRequestDto request)
        {
            try
            {
                var report = await _bureauService.ProcessBureauFile(request);
                return Ok(new { success = true, bureauReportId = report.Id, message = "Bureau file processed successfully" });
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get complete bureau report with all analysis
        /// </summary>
        [HttpGet("{customerId}/report")]
        public async Task<IActionResult> GetBureauReport(int customerId)
        {
            try
            {
                var report = await _bureauService.GetLatestBureauReport(customerId);
                if (report == null)
                    return NotFound(new { success = false, error = "No bureau report found for customer" });

                var detailedReport = await _analysisService.AnalyzeBureauReport(report);
                return Ok(new { success = true, data = detailedReport });
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get bureau report summary (quick view)
        /// </summary>
        [HttpGet("{customerId}/summary")]
        public async Task<IActionResult> GetBureauSummary(int customerId)
        {
            try
            {
                var report = await _bureauService.GetLatestBureauReport(customerId);
                if (report == null)
                    return NotFound(new { success = false, error = "No bureau report found" });

                var summary = new BureauReportSummaryDto
                {
                    Id = report.Id,
                    CustomerName = report.FullName,
                    CreditScore = report.CreditScore,
                    RiskCategory = GetRiskCategory(report.CreditScore),
                    RiskLevel = report.RiskLevel,
                    ApprovalProbability = report.ApprovalProbability,
                    EligibleForLoan = report.EligibleForLoan,
                    GeneratedDate = report.ScoreGeneratedDate,
                    LendingRecommendation = report.LendingRecommendation
                };

                return Ok(new { success = true, data = summary });
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get credit score details
        /// </summary>
        [HttpGet("{customerId}/credit-score")]
        public async Task<IActionResult> GetCreditScore(int customerId)
        {
            try
            {
                var report = await _bureauService.GetLatestBureauReport(customerId);
                if (report == null)
                    return NotFound();

                var scoreDto = new CreditScoreDto
                {
                    Score = report.CreditScore,
                    MaxScore = 900,
                    MinScore = 300,
                    Category = GetRiskCategory(report.CreditScore),
                    IsLiveScore = report.IsLiveScore,
                    EligibleForLoan = report.EligibleForLoan,
                    GeneratedDate = report.ScoreGeneratedDate,
                    GeneratedTime = report.ScoreGeneratedDate.ToString("hh:mm tt"),
                    PositiveFactors = report.PositiveFactors?.ConvertAll(f => new ScoreFactorDto
                    {
                        Factor = f.Factor,
                        ImpactScore = f.ImpactScore,
                        Description = f.Description
                    }) ?? new List<ScoreFactorDto>(),
                    NegativeFactors = report.NegativeFactors?.ConvertAll(f => new ScoreFactorDto
                    {
                        Factor = f.Factor,
                        ImpactScore = f.ImpactScore,
                        Description = f.Description
                    }) ?? new List<ScoreFactorDto>()
                };

                return Ok(new { success = true, data = scoreDto });
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get customer profile from bureau report
        /// </summary>
        [HttpGet("{customerId}/profile")]
        public async Task<IActionResult> GetCustomerProfile(int customerId)
        {
            try
            {
                var report = await _bureauService.GetLatestBureauReport(customerId);
                if (report == null)
                    return NotFound();

                var profile = new CustomerProfileDto
                {
                    FullName = report.FullName,
                    DateOfBirth = report.DateOfBirth,
                    Gender = report.Gender,
                    PAN = MaskPAN(report.PAN),
                    AadhaarMasked = MaskAadhaar(report.AadhaarNumber),
                    CKYCNumber = report.CKYCNumber,
                    MobileNumbers = report.MobileNumbers?.ConvertAll(m => m.PhoneNumber) ?? new List<string>(),
                    EmailAddresses = report.EmailAddresses?.ConvertAll(e => e.EmailAddress) ?? new List<string>(),
                    OccupationType = report.OccupationType,
                    AnnualIncome = report.AnnualIncome
                };

                return Ok(new { success = true, data = profile });
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get account summary dashboard
        /// </summary>
        [HttpGet("{customerId}/account-summary")]
        public async Task<IActionResult> GetAccountSummary(int customerId)
        {
            try
            {
                var report = await _bureauService.GetLatestBureauReport(customerId);
                if (report == null)
                    return NotFound();

                var summary = new AccountSummaryDto
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
                };

                return Ok(new { success = true, data = summary });
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get all loan accounts with pagination and filtering
        /// </summary>
        [HttpGet("{customerId}/accounts")]
        public async Task<IActionResult> GetLoanAccounts(int customerId, [FromQuery] int page = 1, [FromQuery] int pageSize = 10, [FromQuery] string? status = null)
        {
            try
            {
                var (accounts, totalCount) = await _bureauService.GetBureauAccountsPagedAsync(customerId, page, pageSize, status ?? string.Empty);

                var accountDtos = accounts.ConvertAll(a => new BureauAccountDto
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
                    TenureMonths = a.TenureMonths,
                    RemainingTenure = a.RemainingTenure,
                    PaymentFrequency = a.PaymentFrequency,
                    AccountStatus = a.AccountStatus,
                    CurrentDPD = a.DaysOverdue,
                    IsWrittenOff = a.IsWrittenOff,
                    IsSettled = a.IsSettled
                });

                return Ok(new
                {
                    success = true,
                    data = accountDtos,
                    pagination = new { page, pageSize, totalCount, totalPages = (totalCount + pageSize - 1) / pageSize }
                });
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get payment history and DPD analysis
        /// </summary>
        [HttpGet("{customerId}/payment-history")]
        public async Task<IActionResult> GetPaymentHistory(int customerId, [FromQuery] int months = 24)
        {
            try
            {
                var report = await _bureauService.GetLatestBureauReport(customerId);
                if (report == null)
                    return NotFound();

                var history = report.PaymentHistory?
                    .OrderByDescending(p => p.ReportMonth)
                    .Take(months)
                    .OrderBy(p => p.ReportMonth)
                    .ToList() ?? new List<BureauPaymentHistory>();

                var monthlyData = history.ConvertAll(h => new MonthlyPaymentStatusDto
                {
                    ReportMonth = h.ReportMonth,
                    DPDStatus = h.DPDStatus,
                    DaysOverdue = h.DaysOverdue,
                    IsMissedPayment = h.IsMissedPayment,
                    IsWriteOff = h.IsWriteOff,
                    IsSettlement = h.IsSettlement
                });

                return Ok(new { success = true, data = monthlyData });
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get risk analysis
        /// </summary>
        [HttpGet("{customerId}/risk-analysis")]
        public async Task<IActionResult> GetRiskAnalysis(int customerId)
        {
            try
            {
                var report = await _bureauService.GetLatestBureauReport(customerId);
                if (report == null)
                    return NotFound();

                var riskAnalysis = await _analysisService.CalculateRiskAnalysis(report);
                return Ok(new { success = true, data = riskAnalysis });
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get behaviour analysis
        /// </summary>
        [HttpGet("{customerId}/behaviour-analysis")]
        public async Task<IActionResult> GetBehaviourAnalysis(int customerId)
        {
            try
            {
                var report = await _bureauService.GetLatestBureauReport(customerId);
                if (report == null)
                    return NotFound();

                var behaviour = await _analysisService.AnalyzeCreditBehaviour(report);
                return Ok(new { success = true, data = behaviour });
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get enquiry analysis
        /// </summary>
        [HttpGet("{customerId}/enquiry-analysis")]
        public async Task<IActionResult> GetEnquiryAnalysis(int customerId)
        {
            try
            {
                var report = await _bureauService.GetLatestBureauReport(customerId);
                if (report == null)
                    return NotFound();

                var enquiry = await _analysisService.AnalyzeEnquiries(report);
                return Ok(new { success = true, data = enquiry });
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Get bureau report history for customer
        /// </summary>
        [HttpGet("{customerId}/history")]
        public async Task<IActionResult> GetBureauHistory(int customerId, [FromQuery] int limit = 10)
        {
            try
            {
                var reports = await _bureauService.GetBureauReportHistoryAsync(customerId, limit);
                var summaries = reports.ConvertAll(r => new BureauReportSummaryDto
                {
                    Id = r.Id,
                    CustomerName = r.FullName,
                    CreditScore = r.CreditScore,
                    RiskCategory = GetRiskCategory(r.CreditScore),
                    RiskLevel = r.RiskLevel,
                    ApprovalProbability = r.ApprovalProbability,
                    EligibleForLoan = r.EligibleForLoan,
                    GeneratedDate = r.ScoreGeneratedDate,
                    LendingRecommendation = r.LendingRecommendation
                });

                return Ok(new { success = true, data = summaries });
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// Export bureau report as PDF
        /// </summary>
        [HttpPost("{bureauReportId}/export-pdf")]
        public async Task<IActionResult> ExportBureauPDF(int bureauReportId, [FromBody] BureauPDFExportRequestDto request)
        {
            try
            {
                var pdfBytes = await _bureauService.GenerateBureauPDFAsync(bureauReportId, request);
                return File(pdfBytes, "application/pdf", $"BureauReport_{bureauReportId}.pdf");
            }
            catch (Exception ex)
            {
                return BadRequest(new { success = false, error = ex.Message });
            }
        }

        /// <summary>
        /// 🟠 CIBIL Stale Report Check (item #8) — read-only, does NOT trigger a
        /// new bureau pull (no paid API call). Reports how old the customer's
        /// latest bureau report is, so the wizard/detail view can warn the user
        /// when resuming an old draft/application instead of silently working
        /// off a stale score. Threshold (30 days) is a reasonable industry-
        /// common default, not a business rule confirmed anywhere in this
        /// project's existing code — REQUIRES BUSINESS CONFIRMATION if a
        /// different value is intended; configurable via Bureau:StaleAfterDays.
        /// </summary>
        [HttpGet("staleness/{customerId:int}")]
        public async Task<IActionResult> GetStaleness(int customerId, [FromServices] IConfiguration config)
        {
            var latest = await _bureauService.GetLatestBureauReport(customerId);
            if (latest == null)
                return Ok(new { success = true, data = new { hasReport = false, isStale = false } });

            var staleAfterDays = config.GetValue<int?>("Bureau:StaleAfterDays") ?? 30;
            var ageInDays = (DateTime.UtcNow - latest.ScoreGeneratedDate).TotalDays;

            return Ok(new
            {
                success = true,
                data = new
                {
                    hasReport = true,
                    reportDate = latest.ScoreGeneratedDate,
                    ageInDays = Math.Round(ageInDays, 1),
                    staleAfterDays,
                    isStale = ageInDays > staleAfterDays
                }
            });
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

    public interface IBureauService
    {
        Task<BureauReport> ProcessBureauFile(BureauUploadRequestDto request);
        Task<BureauReport> GetLatestBureauReport(int customerId);
        Task<(List<BureauAccount>, int)> GetBureauAccountsPagedAsync(int customerId, int page, int pageSize, string status);
        Task<List<BureauReport>> GetBureauReportHistoryAsync(int customerId, int limit);
        Task<byte[]> GenerateBureauPDFAsync(int bureauReportId, BureauPDFExportRequestDto request);
    }
}
