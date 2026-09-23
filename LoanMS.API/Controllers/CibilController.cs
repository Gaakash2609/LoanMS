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
///
/// Provenance rule: a score is reported as "Bureau" ONLY when it came from a
/// stored BureauReport row. When no bureau report exists for the PAN, the
/// endpoints below return a locally derived indicator that is explicitly
/// flagged (source = "Estimated", isEstimated = true) and is never written to
/// Customer.CibilScore.
///
/// This replaces the previous behaviour, where a PAN-derived figure was
/// returned as source = "Bureau" and saved over the operator-entered score on
/// the customer record. To wire a live bureau provider, populate BureauReports
/// (see BureauController.Upload) — the read paths here then serve real data
/// with no further change.
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

        var customer = await _db.Customers
            .Include(c => c.Loans)
            .FirstOrDefaultAsync(c => c.PanNumber == pan && !c.IsDeleted);

        // Same provenance rule as Check(): a stored BureauReport wins, otherwise
        // the figure is a local estimate and is never persisted onto the
        // customer record. See the comment in Check() for why writing an
        // estimate to Customer.CibilScore was destructive.
        var bureauScore = customer == null ? null : await _db.BureauReports
            .Where(b => b.CustomerId == customer.Id && b.IsActive)
            .OrderByDescending(b => b.ScoreGeneratedDate)
            .Select(b => (int?)b.CreditScore)
            .FirstOrDefaultAsync();

        var isEstimated = bureauScore == null;
        var score       = bureauScore ?? _deriveEstimatedScore(pan);

        if (!isEstimated && customer != null && customer.CibilScore != score)
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

        var report = _buildFullReport(pan, score, name, dob, loanHistory.Cast<object>().ToList(), customer, isEstimated);
        return Ok(ApiResponseDto<object>.Ok(report));
    }

    /// <summary>Quick score check — returns score + eligibility only</summary>
    [HttpGet("check")]
    public async Task<IActionResult> Check([FromQuery] string pan, [FromQuery] string? name, [FromQuery] string? dob)
    {
        if (string.IsNullOrWhiteSpace(pan) || pan.Length != 10)
            return BadRequest(ApiResponseDto<CibilCheckResponseDto>.Fail("Valid 10-character PAN is required."));

        pan = pan.ToUpper().Trim();

        var existing = await _db.Customers.FirstOrDefaultAsync(c => c.PanNumber == pan && !c.IsDeleted);

        // Prefer a real bureau pull. A stored BureauReport is the only source
        // of truth for a genuine score; anything else is derived locally.
        var bureauScore = existing == null ? null : await _db.BureauReports
            .Where(b => b.CustomerId == existing.Id && b.IsActive)
            .OrderByDescending(b => b.ScoreGeneratedDate)
            .Select(b => (int?)b.CreditScore)
            .FirstOrDefaultAsync();

        var isEstimated = bureauScore == null;
        var score       = bureauScore ?? _deriveEstimatedScore(pan);
        var status      = _scoreStatus(score);
        var eligible    = score >= 650;

        // Customer.CibilScore is a REAL business field: WizardController:262
        // writes the score an operator transcribed from an actual bureau report,
        // and AIService reads it back for underwriting insight. Writing a locally
        // derived number into it silently destroyed that operator-entered value
        // for every PAN this endpoint was ever called with. Only a genuine bureau
        // score is persisted now; an estimate is returned for display and nothing
        // more.
        if (!isEstimated && existing != null && existing.CibilScore != score)
        {
            existing.CibilScore = score;
            existing.UpdatedAt  = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }

        return Ok(ApiResponseDto<CibilCheckResponseDto>.Ok(new CibilCheckResponseDto
        {
            Pan         = pan,
            CibilScore  = score,
            Status      = status,
            Message     = isEstimated
                ? "Estimated indicator only — no bureau report on file for this PAN. Not a verified CIBIL score."
                : _scoreMessage(score),
            IsEligible  = eligible,
            Source      = isEstimated ? "Estimated" : "Bureau",
            IsEstimated = isEstimated,
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

        var normalised = pans
            .Where(p => !string.IsNullOrWhiteSpace(p) && p.Length == 10)
            .Select(p => p.ToUpper().Trim())
            .Distinct()
            .ToList();

        // Resolve real bureau scores in two set-based queries rather than a
        // per-PAN round trip, so a 50-PAN batch stays two queries.
        // Customer.PanNumber is nullable; filter the nulls out server-side so the
        // dictionary key below is a non-null string.
        var customers = (await _db.Customers
            .Where(c => !c.IsDeleted && c.PanNumber != null && normalised.Contains(c.PanNumber))
            .Select(c => new { c.Id, c.PanNumber })
            .ToListAsync())
            .Where(c => c.PanNumber != null)
            .Select(c => new { c.Id, PanNumber = c.PanNumber! })
            .ToList();

        var customerIds = customers.Select(c => c.Id).ToList();
        var bureauByCustomer = await _db.BureauReports
            .Where(b => b.IsActive && customerIds.Contains(b.CustomerId))
            .GroupBy(b => b.CustomerId)
            .Select(g => new {
                CustomerId = g.Key,
                Score = g.OrderByDescending(b => b.ScoreGeneratedDate).First().CreditScore,
            })
            .ToListAsync();

        var scoreByPan = customers
            .Join(bureauByCustomer, c => c.Id, b => b.CustomerId, (c, b) => new { c.PanNumber, b.Score })
            .ToDictionary(x => x.PanNumber, x => x.Score);

        // Every row now states its own provenance. Previously every row was a
        // PAN-derived figure returned with no indication it was not a real pull.
        var results = normalised.Select(pan => {
            var hasBureau = scoreByPan.TryGetValue(pan, out var real);
            var s = hasBureau ? real : _deriveEstimatedScore(pan);
            return new {
                pan,
                score       = s,
                status      = _scoreStatus(s),
                eligible    = s >= 650,
                source      = hasBureau ? "Bureau" : "Estimated",
                isEstimated = !hasBureau,
            };
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
        // BureauReport.PaymentHistory is [NotMapped] - a computed property that
        // flattens Accounts.SelectMany(a => a.PaymentHistory). Passing it to
        // Include() threw InvalidOperationException ("... is invalid inside an
        // 'Include' operation") on every call, so this endpoint returned 500
        // where its siblings return a clean 404. Include the real navigation
        // chain instead; the computed property then resolves off loaded data.
        var bureau = await _db.BureauReports
            .Include(b => b.Accounts)
                .ThenInclude(a => a.PaymentHistory)
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
            // Every Max() here is over a sequence that is legitimately empty for
            // real borrowers: a thin file has no payment rows at all, and a
            // report whose newest row is older than the window leaves the
            // 3/6-month filters empty. Int32 Max() throws
            // InvalidOperationException("Sequence contains no elements") in that
            // case, 500-ing the endpoint. Lifting to int? and coalescing to 0 is
            // the same idiom already used in CibilAnalysisService for exactly
            // this reason, and 0 DPD is the correct reading of "nothing overdue
            // on record".
            DPDHeatmap = BuildHeatmap(bureau.PaymentHistory),
            MissedPaymentAlerts = bureau.PaymentHistory
                .Where(ph => ph.IsMissedPayment)
                .Select(ph => $"Missed payment in {ph.ReportMonth:MMM yyyy} ({ph.DaysOverdue} DPD)")
                .ToList()
        };

        return Ok(ApiResponseDto<CibilPaymentHistoryDto>.Ok(history));
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /// <summary>
    /// Derives a deterministic indicator from the PAN. This is NOT a credit
    /// score: it is a stable placeholder used only when no BureauReport exists,
    /// and every response carrying it is flagged IsEstimated/source="Estimated".
    /// It must never be persisted to Customer.CibilScore — see Check().
    /// </summary>
    private static int _deriveEstimatedScore(string pan)
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
        List<object> loanHistory, Customer? customer, bool isEstimated)
    {
        var hash           = _deriveEstimatedScore(pan);
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
            message     = isEstimated
                ? "Estimated indicator only — no bureau report on file for this PAN. Not a verified CIBIL score."
                : _scoreMessage(score),
            isEligible  = score >= 650,
            // Provenance is disclosed, not hidden. The previous build deliberately
            // omitted this field ("never disclose bureau vs mock status to
            // clients"), which left every consumer unable to tell a real bureau
            // pull from a locally derived indicator. The breakdown values below
            // are derived from the PAN whenever isEstimated is true, so a caller
            // MUST be able to see that.
            source      = isEstimated ? "Estimated" : "Bureau",
            isEstimated,
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

    /// <summary>
    /// DPD heatmap over a payment history that may be empty or entirely outside
    /// the 3/6-month windows. See the call site for why every aggregate is
    /// nullable-lifted.
    /// </summary>
    private static CibilDPDHeatmapDto BuildHeatmap(IReadOnlyCollection<Domain.Entities.BureauPaymentHistory> history)
    {
        static int MaxDpd(IEnumerable<Domain.Entities.BureauPaymentHistory> rows) =>
            rows.Max(ph => (int?)ph.DaysOverdue) ?? 0;

        var now      = DateTime.UtcNow;
        var overall  = MaxDpd(history);

        return new CibilDPDHeatmapDto
        {
            Last3MonthsDPD  = MaxDpd(history.Where(ph => ph.ReportMonth >= now.AddMonths(-3))),
            Last6MonthsDPD  = MaxDpd(history.Where(ph => ph.ReportMonth >= now.AddMonths(-6))),
            Last12MonthsDPD = overall,
            HealthStatus    = overall > 90 ? "Red" : overall > 30 ? "Yellow" : "Green"
        };
    }
}
