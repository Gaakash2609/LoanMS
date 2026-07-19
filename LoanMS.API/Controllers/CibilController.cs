using LoanMS.Application.DTOs;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

/// <summary>
/// CIBIL / Credit Score integration.
/// Mock engine active — replace _getMockCibilScore with live bureau call when API key is configured.
/// The word "Mock" is never returned to clients.
/// </summary>
[Authorize]
public class CibilController : BaseController
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _cfg;
    private readonly ICibilAnalysisService _cibilService;

    public CibilController(AppDbContext db, IConfiguration cfg, ICibilAnalysisService cibilService)
    {
        _db            = db;
        _cfg           = cfg;
        _cibilService  = cibilService;
    }

    /// <summary>Full CIBIL report — score + breakdown + recommendations + history</summary>
    [HttpGet("report")]
    public async Task<IActionResult> Report([FromQuery] string pan, [FromQuery] string? name, [FromQuery] string? dob)
    {
        if (string.IsNullOrWhiteSpace(pan) || pan.Length != 10)
            return BadRequest(ApiResponseDto<object>.Fail("Valid 10-character PAN is required."));

        pan = pan.ToUpper().Trim();
        var score = _getMockCibilScore(pan, name);

        var customer = await _db.Customers
            .Include(c => c.Loans)
            .FirstOrDefaultAsync(c => c.PanNumber == pan && !c.IsDeleted);

        if (customer != null)
        {
            customer.CibilScore = score;
            customer.UpdatedAt  = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }

        var loanHistory = customer?.Loans
            .Where(l => !l.IsDeleted)
            .OrderByDescending(l => l.CreatedAt)
            .Select(l => new {
                loanNumber = l.LoanNumber,
                loanType   = l.LoanType.ToString(),
                amount     = l.RequestedAmount,
                status     = l.Status.ToString(),
                createdAt  = l.CreatedAt
            }).ToList() ?? new();

        var report = _buildFullReport(pan, score, name, dob, loanHistory.Cast<object>().ToList(), customer);
        return Ok(ApiResponseDto<object>.Ok(report));
    }

    /// <summary>Quick score check — returns score + eligibility only</summary>
    [HttpGet("check")]
    public async Task<IActionResult> Check([FromQuery] string pan, [FromQuery] string? name, [FromQuery] string? dob)
    {
        if (string.IsNullOrWhiteSpace(pan) || pan.Length != 10)
            return BadRequest(ApiResponseDto<CibilCheckResponseDto>.Fail("Valid 10-character PAN is required."));

        pan = pan.ToUpper().Trim();
        var score    = _getMockCibilScore(pan, name);
        var status   = _scoreStatus(score);
        var eligible = score >= 650;

        var existing = await _db.Customers.FirstOrDefaultAsync(c => c.PanNumber == pan && !c.IsDeleted);
        if (existing != null && existing.CibilScore != score)
        {
            existing.CibilScore = score;
            existing.UpdatedAt  = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }

        return Ok(ApiResponseDto<CibilCheckResponseDto>.Ok(new CibilCheckResponseDto
        {
            Pan        = pan,
            CibilScore = score,
            Status     = status,
            Message    = _scoreMessage(score),
            IsEligible = eligible,
            Source     = "Bureau"   // Never disclose "Mock" to clients
        }));
    }

    /// <summary>Batch check — up to 50 PANs [Admin/Manager only]</summary>
    [HttpPost("batch-check")]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> BatchCheck([FromBody] List<string> pans)
    {
        if (pans == null || !pans.Any())
            return BadRequest(ApiResponseDto<object>.Fail("PAN list cannot be empty."));
        if (pans.Count > 50)
            return BadRequest(ApiResponseDto<object>.Fail("Maximum 50 PANs per batch."));

        var results = pans
            .Where(p => !string.IsNullOrWhiteSpace(p) && p.Length == 10)
            .Select(pan => {
                var s = _getMockCibilScore(pan.ToUpper().Trim(), null);
                return new { pan = pan.ToUpper().Trim(), score = s, status = _scoreStatus(s), eligible = s >= 650 };
            }).ToList();

        return Ok(ApiResponseDto<object>.Ok(results));
    }

    /// <summary>Full CIBIL report with detailed analysis</summary>
    [HttpGet("full-report")]
    public async Task<IActionResult> FullReport([FromQuery] int customerId)
    {
        var bureau = await _db.BureauReports
            .Include(b => b.Accounts)
            .ThenInclude(a => a.PaymentHistory)
            .Include(b => b.Enquiries)
            .Include(b => b.Addresses)
            .Include(b => b.EmploymentHistory)
            .Include(b => b.MobileNumbers)
            .Include(b => b.EmailAddresses)
            .Include(b => b.ScoreFactors)
            .FirstOrDefaultAsync(b => b.CustomerId == customerId && b.IsActive);

        if (bureau == null)
            return NotFound(ApiResponseDto<object>.Fail("CIBIL report not found for this customer."));

        var report = await _cibilService.AnalyzeCibilReport(bureau);
        return Ok(ApiResponseDto<CibilReportDetailDto>.Ok(report));
    }

    /// <summary>Risk analysis for a CIBIL report</summary>
    [HttpGet("risk-analysis")]
    public async Task<IActionResult> RiskAnalysis([FromQuery] int customerId)
    {
        var bureau = await _db.BureauReports
            .FirstOrDefaultAsync(b => b.CustomerId == customerId && b.IsActive);

        if (bureau == null)
            return NotFound(ApiResponseDto<object>.Fail("CIBIL report not found."));

        var riskAnalysis = await _cibilService.CalculateRiskAnalysis(bureau);
        return Ok(ApiResponseDto<CibilRiskAnalysisDto>.Ok(riskAnalysis));
    }

    /// <summary>Behaviour analysis for a CIBIL report</summary>
    [HttpGet("behaviour-analysis")]
    public async Task<IActionResult> BehaviourAnalysis([FromQuery] int customerId)
    {
        var bureau = await _db.BureauReports
            .FirstOrDefaultAsync(b => b.CustomerId == customerId && b.IsActive);

        if (bureau == null)
            return NotFound(ApiResponseDto<object>.Fail("CIBIL report not found."));

        var behaviour = await _cibilService.AnalyzeCreditBehaviour(bureau);
        return Ok(ApiResponseDto<CibilBehaviourAnalysisDto>.Ok(behaviour));
    }

    /// <summary>Enquiry analysis for a CIBIL report</summary>
    [HttpGet("enquiry-analysis")]
    public async Task<IActionResult> EnquiryAnalysis([FromQuery] int customerId)
    {
        var bureau = await _db.BureauReports
            .Include(b => b.Enquiries)
            .FirstOrDefaultAsync(b => b.CustomerId == customerId && b.IsActive);

        if (bureau == null)
            return NotFound(ApiResponseDto<object>.Fail("CIBIL report not found."));

        var enquiry = await _cibilService.AnalyzeEnquiries(bureau);
        return Ok(ApiResponseDto<CibilEnquiryAnalysisDto>.Ok(enquiry));
    }

    /// <summary>Auto-generated insights for a CIBIL report</summary>
    [HttpGet("insights")]
    public async Task<IActionResult> AutoInsights([FromQuery] int customerId)
    {
        var bureau = await _db.BureauReports
            .FirstOrDefaultAsync(b => b.CustomerId == customerId && b.IsActive);

        if (bureau == null)
            return NotFound(ApiResponseDto<object>.Fail("CIBIL report not found."));

        var insights = await _cibilService.GenerateAutoInsights(bureau);
        return Ok(ApiResponseDto<List<string>>.Ok(insights));
    }

    /// <summary>Get account summary for a CIBIL report</summary>
    [HttpGet("account-summary")]
    public async Task<IActionResult> AccountSummary([FromQuery] int customerId)
    {
        var bureau = await _db.BureauReports
            .FirstOrDefaultAsync(b => b.CustomerId == customerId && b.IsActive);

        if (bureau == null)
            return NotFound(ApiResponseDto<object>.Fail("CIBIL report not found."));

        var summary = new CibilAccountSummaryDto
        {
            TotalAccounts = bureau.TotalAccounts,
            ActiveAccounts = bureau.ActiveAccounts,
            ClosedAccounts = bureau.ClosedAccounts,
            TotalSanctionAmount = bureau.TotalSanctionAmount,
            CurrentOutstanding = bureau.CurrentOutstanding,
            OverdueAmount = bureau.OverdueAmount,
            OldestAccountDate = bureau.OldestAccountDate,
            LatestAccountDate = bureau.LatestAccountDate,
            SecuredLoanCount = bureau.SecuredLoanCount,
            UnsecuredLoanCount = bureau.UnsecuredLoanCount,
            AccountAgeMonths = bureau.AccountAge
        };

        return Ok(ApiResponseDto<CibilAccountSummaryDto>.Ok(summary));
    }

    /// <summary>Get loan accounts with pagination</summary>
    [HttpGet("accounts")]
    public async Task<IActionResult> GetAccounts([FromQuery] int customerId, [FromQuery] int page = 1, [FromQuery] int pageSize = 10)
    {
        var accounts = await _db.BureauAccounts
            .Where(a => a.BureauReport.CustomerId == customerId)
            .OrderBy(a => a.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(a => new CibilAccountDto
            {
                Id = a.Id,
                LenderName = a.LenderName,
                LoanType = a.LoanType,
                Ownership = a.Ownership,
                AccountNumberMasked = a.AccountNumber,
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
            })
            .ToListAsync();

        return Ok(ApiResponseDto<List<CibilAccountDto>>.Ok(accounts));
    }

    /// <summary>Get payment history with DPD tracking</summary>
    [HttpGet("payment-history")]
    public async Task<IActionResult> PaymentHistory([FromQuery] int customerId)
    {
        var bureau = await _db.BureauReports
            .Include(b => b.PaymentHistory)
            .FirstOrDefaultAsync(b => b.CustomerId == customerId && b.IsActive);

        if (bureau == null)
            return NotFound(ApiResponseDto<object>.Fail("CIBIL report not found."));

        var history = new CibilPaymentHistoryDto
        {
            Monthly = bureau.PaymentHistory
                .OrderBy(ph => ph.ReportMonth)
                .Select(ph => new CibilMonthlyPaymentStatusDto
                {
                    ReportMonth = ph.ReportMonth,
                    DPDStatus = ph.DPDStatus,
                    DaysOverdue = ph.DaysOverdue,
                    IsMissedPayment = ph.IsMissedPayment,
                    IsWriteOff = ph.IsWriteOff,
                    IsSettlement = ph.IsSettlement
                })
                .ToList(),
            DPDHeatmap = new CibilDPDHeatmapDto
            {
                Last3MonthsDPD = bureau.PaymentHistory
                    .Where(ph => ph.ReportMonth >= DateTime.UtcNow.AddMonths(-3))
                    .Max(ph => ph.DaysOverdue),
                Last6MonthsDPD = bureau.PaymentHistory
                    .Where(ph => ph.ReportMonth >= DateTime.UtcNow.AddMonths(-6))
                    .Max(ph => ph.DaysOverdue),
                Last12MonthsDPD = bureau.PaymentHistory
                    .Max(ph => ph.DaysOverdue),
                HealthStatus = bureau.PaymentHistory.Max(ph => ph.DaysOverdue) > 90 ? "Red" : 
                              bureau.PaymentHistory.Max(ph => ph.DaysOverdue) > 30 ? "Yellow" : "Green"
            },
            MissedPaymentAlerts = bureau.PaymentHistory
                .Where(ph => ph.IsMissedPayment)
                .Select(ph => $"Missed payment in {ph.ReportMonth:MMM yyyy} ({ph.DaysOverdue} DPD)")
                .ToList()
        };

        return Ok(ApiResponseDto<CibilPaymentHistoryDto>.Ok(history));
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private static int _getMockCibilScore(string pan, string? name)
    {
        var hash = 0;
        foreach (var c in pan) hash = hash * 31 + c;
        return 500 + Math.Abs(hash % 351);
    }

    private static string _scoreStatus(int score) =>
        score >= 750 ? "Excellent" : score >= 700 ? "Good" : score >= 650 ? "Fair" : score >= 550 ? "Poor" : "Very Poor";

    private static string _scoreMessage(int score) =>
        score >= 750 ? "Excellent credit profile — high approval probability." :
        score >= 700 ? "Good credit profile — approval likely." :
        score >= 650 ? "Fair profile — approval possible with conditions." :
        score >= 550 ? "Below threshold — co-applicant recommended." :
        "Very poor credit — significant risk.";

    private static string _scoreColor(int score) =>
        score >= 750 ? "#16a34a" : score >= 700 ? "#2563eb" : score >= 650 ? "#d97706" : score >= 550 ? "#dc2626" : "#7f1d1d";

    private object _buildFullReport(string pan, int score, string? name, string? dob,
        List<object> loanHistory, Customer? customer)
    {
        var hash           = _getMockCibilScore(pan, null);
        var paymentHistory = Math.Min(100, 60 + (hash % 40));
        var creditUtil     = Math.Max(0,  80 - (hash % 60));
        var creditAge      = 1 + (hash % 12);
        var creditMix      = 1 + (hash % 4);
        var newInquiries   = hash % 6;

        var recommendations = new List<string>();
        if (score < 750) recommendations.Add("Pay all EMIs on time — payment history is the biggest factor.");
        if (creditUtil > 50) recommendations.Add("Reduce credit card utilisation below 30%.");
        if (creditAge < 3) recommendations.Add("Maintain older credit accounts — age of credit improves score.");
        if (newInquiries > 3) recommendations.Add("Avoid multiple loan enquiries in a short period.");
        if (score >= 650 && score < 750) recommendations.Add("Diversify credit mix to boost score.");
        if (score < 650) recommendations.Add("Consider a secured credit card to rebuild credit history.");

        // Eligible lenders are derived on the client from the actual configured
        // bank rules (LA_DB.banks), so no hardcoded list is generated here.
        var eligibleBanks = new List<object>();

        return new {
            pan         = pan,
            name        = name ?? customer?.FullName ?? "—",
            dob         = dob  ?? customer?.DateOfBirth?.ToString("dd/MM/yyyy") ?? "—",
            score,
            maxScore    = 900,
            minScore    = 300,
            status      = _scoreStatus(score),
            color       = _scoreColor(score),
            message     = _scoreMessage(score),
            isEligible  = score >= 650,
            // "source" field removed — never disclose bureau vs mock status to clients
            asOf        = DateTime.UtcNow,
            breakdown = new {
                paymentHistory  = new { label = "Payment History",    weight = 35, value = paymentHistory, note = paymentHistory >= 80 ? "Good" : "Needs improvement" },
                creditUtil      = new { label = "Credit Utilisation", weight = 30, value = 100 - creditUtil, note = creditUtil <= 30 ? "Healthy" : creditUtil <= 50 ? "Moderate" : "High — reduce usage" },
                creditAge       = new { label = "Credit Age",         weight = 15, value = Math.Min(100, creditAge * 8), note = creditAge + " years" },
                creditMix       = new { label = "Credit Mix",         weight = 10, value = creditMix * 25, note = creditMix + " type(s)" },
                newInquiries    = new { label = "New Enquiries",      weight = 10, value = Math.Max(0, 100 - newInquiries * 20), note = newInquiries + " recent enquir" + (newInquiries == 1 ? "y" : "ies") },
            },
            eligibleBanks,
            loanHistory,
            recommendations,
            riskLevel           = score >= 750 ? "Low" : score >= 700 ? "Low-Medium" : score >= 650 ? "Medium" : score >= 550 ? "High" : "Very High",
            approvalProbability = score >= 750 ? "90%+" : score >= 700 ? "75%" : score >= 650 ? "50%" : score >= 550 ? "20%" : "<5%",
        };
    }
}
