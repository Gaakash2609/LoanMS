using System.Text;
using LoanMS.Application.DTOs;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

[Authorize]
public class ReportsController : BaseController
{
    private readonly AppDbContext _db;
    private readonly LoanMS.API.Services.IRolePermissionService _rolePerm;
    public ReportsController(AppDbContext db, LoanMS.API.Services.IRolePermissionService rolePerm) { _db = db; _rolePerm = rolePerm; }

    // ── Phase 5C — RPT Targets ────────────────────────────────────────────────
    // Reuses the existing AppSettings key-value table (already in production
    // since an earlier phase — same table SettingsController uses for InCred/AI
    // credentials) instead of introducing a new table for two numbers. Falls
    // back to the original hardcoded defaults (7.0 / 95.0) whenever a value
    // hasn't been configured yet, so Summary()'s existing behavior is
    // unchanged for every environment until an Admin explicitly sets a target.
    private const string KEY_TAT_TARGET_DAYS = "rpt_tat_target_days";
    private const string KEY_DDR_TARGET_PCT  = "rpt_ddr_target_pct";
    private const double DEFAULT_TAT_TARGET_DAYS = 7.0;
    private const double DEFAULT_DDR_TARGET_PCT  = 95.0;

    private async Task<(double tatTarget, double ddrTarget)> GetReportTargetsAsync()
    {
        var tatRaw = await _db.AppSettings.Where(s => s.Key == KEY_TAT_TARGET_DAYS).Select(s => s.Value).FirstOrDefaultAsync();
        var ddrRaw = await _db.AppSettings.Where(s => s.Key == KEY_DDR_TARGET_PCT).Select(s => s.Value).FirstOrDefaultAsync();
        var tat = double.TryParse(tatRaw, out var t) ? t : DEFAULT_TAT_TARGET_DAYS;
        var ddr = double.TryParse(ddrRaw, out var d) ? d : DEFAULT_DDR_TARGET_PCT;
        return (tat, ddr);
    }

    // Read: any authenticated user with report access can view current targets
    // (same as Summary below, which already embeds these values).
    [HttpGet("targets")]
    public async Task<IActionResult> GetTargets()
    {
        var (tat, ddr) = await GetReportTargetsAsync();
        return Ok(ApiResponseDto<object>.Ok(new { tatTargetDays = tat, ddrTargetPct = ddr }));
    }

    // Write: Admin only, matching the RBAC convention already used for
    // Settings/Locations/Banks mutation endpoints.
    [HttpPut("targets")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> UpdateTargets([FromBody] ReportTargetsDto dto)
    {
        if (dto.TatTargetDays.HasValue && dto.TatTargetDays.Value <= 0)
            return BadRequest(ApiResponseDto<object>.Fail("TAT target must be a positive number of days."));
        if (dto.DdrTargetPct.HasValue && (dto.DdrTargetPct.Value < 0 || dto.DdrTargetPct.Value > 100))
            return BadRequest(ApiResponseDto<object>.Fail("DDR target must be between 0 and 100."));
        if (!dto.TatTargetDays.HasValue && !dto.DdrTargetPct.HasValue)
            return BadRequest(ApiResponseDto<object>.Fail("Provide at least one of tatTargetDays or ddrTargetPct."));

        if (dto.TatTargetDays.HasValue)
            await UpsertReportTargetSetting(KEY_TAT_TARGET_DAYS, dto.TatTargetDays.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));
        if (dto.DdrTargetPct.HasValue)
            await UpsertReportTargetSetting(KEY_DDR_TARGET_PCT, dto.DdrTargetPct.Value.ToString(System.Globalization.CultureInfo.InvariantCulture));

        await _db.SaveChangesAsync();
        var (tat, ddr) = await GetReportTargetsAsync();
        return Ok(ApiResponseDto<object>.Ok(new { tatTargetDays = tat, ddrTargetPct = ddr }, "Targets updated."));
    }

    private async Task UpsertReportTargetSetting(string key, string value)
    {
        var existing = await _db.AppSettings.FirstOrDefaultAsync(s => s.Key == key);
        if (existing != null)
        {
            existing.Value = value; existing.Category = "reports";
            existing.UpdatedAt = DateTime.UtcNow; existing.IsDeleted = false;
        }
        else
        {
            _db.AppSettings.Add(new LoanMS.Domain.Entities.AppSetting
            {
                Key = key, Value = value, Category = "reports", CreatedAt = DateTime.UtcNow
            });
        }
    }

    [HttpGet("pipeline")]
    public async Task<IActionResult> Pipeline([FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        var q = _db.Loans.Include(l => l.Customer).Include(l => l.CreatedBy).AsQueryable();
        if (from.HasValue) q = q.Where(l => l.CreatedAt >= from.Value);
        if (to.HasValue)   q = q.Where(l => l.CreatedAt <= to.Value);

        var data = await q.GroupBy(l => l.Status)
            .Select(g => new {
                Status = g.Key.ToString(),
                Count  = g.Count(),
                Total  = g.Sum(l => l.RequestedAmount)
            }).ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(data));
    }

    [HttpGet("performance")]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> Performance([FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        var q = _db.Loans.Include(l => l.CreatedBy).AsQueryable();
        if (from.HasValue) q = q.Where(l => l.CreatedAt >= from.Value);
        if (to.HasValue)   q = q.Where(l => l.CreatedAt <= to.Value);

        var data = await q.GroupBy(l => l.CreatedBy.FullName)
            .Select(g => new {
                SalesPerson     = g.Key,
                TotalApps       = g.Count(),
                Disbursed       = g.Count(l => l.Status == Domain.Enums.LoanStatus.Disbursed),
                Rejected        = g.Count(l => l.Status == Domain.Enums.LoanStatus.Rejected),
                TotalAmount     = g.Sum(l => l.RequestedAmount),
                DisbursedAmount = g.Where(l => l.ApprovedAmount.HasValue).Sum(l => l.ApprovedAmount!.Value)
            }).ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(data));
    }

    [HttpGet("disbursement")]
    public async Task<IActionResult> Disbursement([FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        var q = _db.Loans
            .Where(l => l.Status == Domain.Enums.LoanStatus.Disbursed)
            .Include(l => l.Customer).Include(l => l.CreatedBy)
            .AsQueryable();
        if (from.HasValue) q = q.Where(l => l.DisbursedAt >= from.Value);
        if (to.HasValue)   q = q.Where(l => l.DisbursedAt <= to.Value);

        var data = await q.Select(l => new {
            l.LoanNumber, CustomerName = l.Customer.FullName,
            l.LoanType, l.ApprovedAmount, l.InterestRate,
            l.TenureMonths, SalesPerson = l.CreatedBy.FullName, l.DisbursedAt
        }).ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(data));
    }

    [HttpGet("rejection")]
    public async Task<IActionResult> RejectionAnalysis([FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        var q = _db.Loans
            .Where(l => l.Status == Domain.Enums.LoanStatus.Rejected)
            .Include(l => l.Customer)
            .AsQueryable();
        if (from.HasValue) q = q.Where(l => l.UpdatedAt >= from.Value);
        if (to.HasValue)   q = q.Where(l => l.UpdatedAt <= to.Value);

        var data = await q.GroupBy(l => l.LoanType)
            .Select(g => new {
                LoanType = g.Key.ToString(),
                Count    = g.Count(),
                Total    = g.Sum(l => l.RequestedAmount)
            }).ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(data));
    }

    [HttpGet("monthly")]
    public async Task<IActionResult> Monthly([FromQuery] int months = 12)
    {
        var from  = DateTime.UtcNow.AddMonths(-months);
        var loans = await _db.Loans
            .Where(l => l.CreatedAt >= from)
            .Select(l => new {
                l.Status, l.RequestedAmount, l.ApprovedAmount,
                MonthKey = l.CreatedAt.Year * 100 + l.CreatedAt.Month
            }).ToListAsync();

        var grouped = loans.GroupBy(l => l.MonthKey)
            .OrderBy(g => g.Key)
            .Select(g => {
                var total    = g.Count();
                var disb     = g.Count(l => l.Status == Domain.Enums.LoanStatus.Disbursed);
                var approved = g.Count(l => l.Status == Domain.Enums.LoanStatus.Approved || l.Status == Domain.Enums.LoanStatus.Disbursed);
                var rejected = g.Count(l => l.Status == Domain.Enums.LoanStatus.Rejected);
                var monthStr = new DateTime(g.Key / 100, g.Key % 100, 1).ToString("MMM yyyy");
                return new MonthlyReportDto
                {
                    Month          = monthStr,
                    TotalApps      = total,
                    Approved       = approved,
                    Rejected       = rejected,
                    Disbursed      = disb,
                    TotalAmount    = g.Sum(l => l.RequestedAmount),
                    DisbursedAmt   = g.Where(l => l.ApprovedAmount.HasValue && l.Status == Domain.Enums.LoanStatus.Disbursed).Sum(l => l.ApprovedAmount!.Value),
                    ConversionRate = total > 0 ? Math.Round((decimal)disb / total * 100, 1) : 0
                };
            }).ToList();

        return Ok(ApiResponseDto<object>.Ok(new {
            months  = grouped,
            summary = new {
                totalApps      = grouped.Sum(m => m.TotalApps),
                totalDisbursed = grouped.Sum(m => m.Disbursed),
                totalAmount    = grouped.Sum(m => m.TotalAmount),
                disbursedAmt   = grouped.Sum(m => m.DisbursedAmt),
                avgConversion  = grouped.Any() ? Math.Round(grouped.Average(m => m.ConversionRate), 1) : 0
            }
        }));
    }

    /// <summary>Export as CSV — Admin and Manager only.</summary>
    [HttpGet("export")]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> Export(
        [FromQuery] string type = "disbursement",
        [FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
    {
        var sb = new StringBuilder();

        if (type == "disbursement")
        {
            var q = _db.Loans.Where(l => l.Status == Domain.Enums.LoanStatus.Disbursed)
                .Include(l => l.Customer).Include(l => l.CreatedBy).AsQueryable();
            if (from.HasValue) q = q.Where(l => l.DisbursedAt >= from.Value);
            if (to.HasValue)   q = q.Where(l => l.DisbursedAt <= to.Value.AddDays(1));

            var data = await q.Select(l => new {
                l.LoanNumber, CustomerName = l.Customer.FullName,
                // Phone omitted from export — PII minimisation
                LoanType    = l.LoanType.ToString(),
                l.ApprovedAmount, l.InterestRate, l.TenureMonths,
                SalesPerson = l.CreatedBy.FullName,
                DisbursedAt = l.DisbursedAt.HasValue ? l.DisbursedAt.Value.ToString("dd/MM/yyyy") : ""
            }).ToListAsync();

            sb.AppendLine("Loan Number,Customer Name,Loan Type,Amount,Rate,Tenure,Sales Person,Disbursed At");
            foreach (var r in data)
                sb.AppendLine($"{r.LoanNumber},{r.CustomerName},{r.LoanType},{r.ApprovedAmount},{r.InterestRate},{r.TenureMonths},{r.SalesPerson},{r.DisbursedAt}");
        }
        else if (type == "pipeline")
        {
            var q = _db.Loans.Include(l => l.Customer).Include(l => l.CreatedBy).AsQueryable();
            if (from.HasValue) q = q.Where(l => l.CreatedAt >= from.Value);
            if (to.HasValue)   q = q.Where(l => l.CreatedAt <= to.Value.AddDays(1));

            var data = await q.Select(l => new {
                l.LoanNumber, CustomerName = l.Customer.FullName,
                LoanType    = l.LoanType.ToString(), Status = l.Status.ToString(),
                l.RequestedAmount, SalesPerson = l.CreatedBy.FullName,
                CreatedAt   = l.CreatedAt.ToString("dd/MM/yyyy")
            }).ToListAsync();

            sb.AppendLine("Loan Number,Customer,Loan Type,Status,Amount,Sales Person,Created At");
            foreach (var r in data)
                sb.AppendLine($"{r.LoanNumber},{r.CustomerName},{r.LoanType},{r.Status},{r.RequestedAmount},{r.SalesPerson},{r.CreatedAt}");
        }

        var bytes    = Encoding.UTF8.GetBytes(sb.ToString());
        var fileName = $"report_{type}_{DateTime.UtcNow:yyyyMMdd}.csv";
        return File(bytes, "text/csv", fileName);
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "reports"))
            return Forbid();

        var now   = DateTime.UtcNow;
        var month = new DateTime(now.Year, now.Month, 1);

        // Base query with date range
        var q = _db.Loans.AsQueryable();
        if (from.HasValue) q = q.Where(l => l.CreatedAt >= from.Value);
        if (to.HasValue)   q = q.Where(l => l.CreatedAt <= to.Value);

        var stats = await q.GroupBy(_ => 1).Select(g => new {
            Total     = g.Count(),
            ThisMonth = g.Count(l => l.CreatedAt >= month),
            Pending   = g.Count(l => l.Status == Domain.Enums.LoanStatus.Submitted || l.Status == Domain.Enums.LoanStatus.UnderReview),
            Approved  = g.Count(l => l.Status == Domain.Enums.LoanStatus.Approved),
            Disbursed = g.Count(l => l.Status == Domain.Enums.LoanStatus.Disbursed),
            Rejected  = g.Count(l => l.Status == Domain.Enums.LoanStatus.Rejected),
            TotalReq  = g.Sum(l => l.RequestedAmount),
            TotalAppr = g.Where(l => l.ApprovedAmount != null).Sum(l => l.ApprovedAmount ?? 0),
            TotalDisb = g.Where(l => l.Status == Domain.Enums.LoanStatus.Disbursed).Sum(l => l.ApprovedAmount ?? 0),
            MonthReq  = g.Where(l => l.CreatedAt >= month).Sum(l => l.RequestedAmount)
        }).FirstOrDefaultAsync();

        // Get detailed loans WITH documents for TAT and DDR calculations
        var loansWithDocs = await q
            .Where(l => l.Status == Domain.Enums.LoanStatus.Disbursed)
            .Include(l => l.Documents)
            .Select(l => new {
                l.Id,
                l.LoanNumber,
                l.CreatedAt,
                l.DisbursedAt,
                l.Status,
                DocumentCount = l.Documents.Count,
                HasDDR = l.Documents.Any(d => d.DocumentType.ToLower().Contains("ddr") || 
                                              d.DocumentType.ToLower().Contains("due diligence") ||
                                              d.DocumentName.ToLower().Contains("ddr")),
                LoanType = l.LoanType.ToString(),
                ApprovedAmount = l.ApprovedAmount ?? 0
            })
            .ToListAsync();

        // Calculate TAT (Turnaround Time from Creation to Disbursement)
        double avgTatDays = 0;
        int disbursedCount = 0;
        
        if (loansWithDocs.Any(l => l.DisbursedAt.HasValue))
        {
            var disbursedLoans = loansWithDocs.Where(l => l.DisbursedAt.HasValue).ToList();
            avgTatDays = disbursedLoans
                .Average(l => (l.DisbursedAt!.Value - l.CreatedAt).TotalDays);
            disbursedCount = disbursedLoans.Count;
        }

        // Calculate DDR Ratio (Due Diligence Report completion among disbursed loans)
        double ddrRatio = 0;
        if (loansWithDocs.Any())
        {
            var loansWithDDR = loansWithDocs.Count(l => l.HasDDR);
            var totalLoans = loansWithDocs.Count;
            ddrRatio = totalLoans > 0 ? (loansWithDDR / (double)totalLoans) * 100 : 0;
        }

        var customers   = await _db.Customers.CountAsync(c => !c.IsDeleted);
        var tasks       = await _db.Tasks.CountAsync(t => !t.IsCompleted && !t.IsDeleted);
        var tickets     = await _db.Tickets.CountAsync(t => t.Status == "Open" && !t.IsDeleted);

        var loansByStatus = await q.GroupBy(l => l.Status)
            .Select(g => new {
                status = g.Key.ToString(),
                count = g.Count()
            }).ToListAsync();

        var loansByType = await q.GroupBy(l => l.LoanType)
            .Select(g => new {
                loanType = g.Key.ToString(),
                count = g.Count(),
                totalAmount = g.Sum(l => l.RequestedAmount)
            }).ToListAsync();

        var monthlyDisbursements = await _db.Loans
            .Where(l => l.Status == Domain.Enums.LoanStatus.Disbursed)
            .Where(l => from == null || l.DisbursedAt >= from.Value)
            .Where(l => to == null || l.DisbursedAt <= to.Value)
            .GroupBy(l => new { l.DisbursedAt!.Value.Year, l.DisbursedAt!.Value.Month })
            .Select(g => new {
                month = $"{g.Key.Year}-{g.Key.Month:D2}",
                count = g.Count(),
                amount = g.Sum(l => l.ApprovedAmount ?? 0)
            })
            .OrderBy(x => x.month)
            .ToListAsync();

        var topAgents = await _db.Loans
            .Where(l => from == null || l.CreatedAt >= from.Value)
            .Where(l => to == null || l.CreatedAt <= to.Value)
            .Include(l => l.CreatedBy)
            .GroupBy(l => l.CreatedBy.FullName)
            .Select(g => new {
                agentName = g.Key,
                loanCount = g.Count(),
                totalAmount = g.Sum(l => l.RequestedAmount)
            })
            .OrderByDescending(x => x.loanCount)
            .Take(10)
            .ToListAsync();

        var conversionRate = stats?.Total > 0 ? Math.Round((stats.Disbursed / (double)stats.Total) * 100, 2) : 0;
        var averageLoanAmount = stats?.Total > 0 ? Math.Round((double)stats.TotalReq / (double)stats.Total, 0) : 0;

        // Phase 5C: targets now come from AppSettings (DB), falling back to the
        // original hardcoded defaults when unconfigured — see GetReportTargetsAsync.
        var (tatTarget, ddrTarget) = await GetReportTargetsAsync();

        return Ok(ApiResponseDto<object>.Ok(new {
            loans = stats,
            loansByStatus = loansByStatus,
            loansByType = loansByType,
            monthlyDisbursements = monthlyDisbursements,
            topAgents = topAgents,
            customers,
            openTasks = tasks,
            openTickets = tickets,
            // TAT and DDR metrics (Real calculations from DB)
            avgTatDays = Math.Round(avgTatDays, 2),
            tatTarget = tatTarget,
            disbursedLoans = disbursedCount,
            ddrRatio = Math.Round(ddrRatio, 2),
            ddrTarget = ddrTarget,
            conversionRate = conversionRate,
            averageLoanAmount = (long)averageLoanAmount,
            totalPortfolio = stats?.TotalDisb ?? 0,
            asOf = now
        }));
    }
}

public class ReportTargetsDto
{
    public double? TatTargetDays { get; set; }
    public double? DdrTargetPct { get; set; }
}
