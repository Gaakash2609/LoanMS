using System.Text;
using LoanMS.Application.DTOs;
using LoanMS.Infrastructure.Data;
using LoanMS.Infrastructure.Repositories;
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
    public async Task<IActionResult> Pipeline([FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string? scope, [FromQuery] int? userId, [FromQuery] int? teamId, [FromQuery] LoanMS.Domain.Enums.LoanStatus? status)
    {
        // BUGFIX (confirmed real access-control bypass — Reports fix Phase 1):
        // reuses the exact same, single, centralized visibility rule
        // Loans/Dashboard/Search already use.
        var q = LoanRepository.ApplyReportNarrowing(_db,
            LoanRepository.ApplyVisibilityScope(_db, _db.Loans.IncludeDeletedUsers(), CurrentUserId, CurrentUserRole),
            CurrentUserId, CurrentUserRole, scope, userId, teamId, status)
            .Include(l => l.Customer).Include(l => l.CreatedBy).AsQueryable();
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
    public async Task<IActionResult> Performance([FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string? scope, [FromQuery] int? userId, [FromQuery] int? teamId, [FromQuery] LoanMS.Domain.Enums.LoanStatus? status)
    {
        var q = LoanRepository.ApplyReportNarrowing(_db,
            LoanRepository.ApplyVisibilityScope(_db, _db.Loans.IncludeDeletedUsers(), CurrentUserId, CurrentUserRole),
            CurrentUserId, CurrentUserRole, scope, userId, teamId, status)
            .Include(l => l.CreatedBy).AsQueryable();
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

    /// <summary>
    /// Active Time aggregated by user or team — parity with Vanilla's
    /// renderActiveTimeAgg() (efin-app.js:12399). Active hours per loan =
    /// CreatedAt → the transition into a terminal status (Disbursed/Rejected/
    /// Closed/OnHold), or → now while still in-flight. Grouped by the sales
    /// person (CreatedBy) or the sales team, with per-group apps / disbursed /
    /// avg / total / longest hours, sorted by total desc.
    /// </summary>
    [HttpGet("active-time")]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> ActiveTime([FromQuery] string? mode, [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string? scope, [FromQuery] int? userId, [FromQuery] int? teamId, [FromQuery] LoanMS.Domain.Enums.LoanStatus? status)
    {
        var q = LoanRepository.ApplyReportNarrowing(_db,
            LoanRepository.ApplyVisibilityScope(_db, _db.Loans.IncludeDeletedUsers(), CurrentUserId, CurrentUserRole),
            CurrentUserId, CurrentUserRole, scope, userId, teamId, status)
            .Include(l => l.CreatedBy).Include(l => l.StatusHistory).AsQueryable();
        if (from.HasValue) q = q.Where(l => l.CreatedAt >= from.Value);
        if (to.HasValue)   q = q.Where(l => l.CreatedAt <= to.Value);
        var loans = await q.ToListAsync();

        var now = DateTime.UtcNow;
        static bool IsTerminal(Domain.Enums.LoanStatus s) =>
            s is Domain.Enums.LoanStatus.Disbursed or Domain.Enums.LoanStatus.Rejected
              or Domain.Enums.LoanStatus.Closed or Domain.Enums.LoanStatus.OnHold;
        double ActiveHours(Domain.Entities.Loan l)
        {
            var end = now;
            if (IsTerminal(l.Status))
            {
                var term = l.StatusHistory?
                    .Where(h => IsTerminal(h.ToStatus))
                    .OrderByDescending(h => h.CreatedAt)
                    .FirstOrDefault();
                end = term?.CreatedAt ?? l.DisbursedAt ?? l.ClosedAt ?? l.UpdatedAt ?? now;
            }
            return Math.Max(0, (end - l.CreatedAt).TotalHours);
        }

        var byGroup = string.Equals(mode, "group", StringComparison.OrdinalIgnoreCase);
        var data = loans
            .GroupBy(l => byGroup
                ? (string.IsNullOrWhiteSpace(l.SalesTeamName) ? "— Unassigned —" : l.SalesTeamName!)
                : (l.CreatedBy?.FullName ?? "— Unassigned —"))
            .Select(g => new {
                Name         = g.Key,
                Count        = g.Count(),
                Disbursed    = g.Count(l => l.Status == Domain.Enums.LoanStatus.Disbursed),
                TotalHours   = Math.Round(g.Sum(ActiveHours), 2),
                AvgHours     = Math.Round(g.Average(ActiveHours), 2),
                LongestHours = Math.Round(g.Max(ActiveHours), 2),
            })
            .OrderByDescending(x => x.TotalHours)
            .ToList();
        return Ok(ApiResponseDto<object>.Ok(data));
    }

    /// <summary>
    /// Monthly Target achievement — parity with Vanilla's "Monthly Targets &amp;
    /// Achievements" cards (efin-app.js renderReports, ~13290-13323), which the
    /// React Reports page has never had a caller for (only /targets, the two
    /// org-wide TAT/DDR scalars, was ever wired up — this is the separate
    /// per-month Disb.Amount/Login Count/Disb.Count record ReportTargetsController
    /// already CRUDs, but nothing computed the *achieved* side against it).
    ///
    /// Always the CURRENT calendar month (server UtcNow) — Vanilla computes this
    /// from `now`, not the Reports page's date-range filter (thisMonthKey,
    /// efin-app.js:12972), so `from`/`to` are deliberately not accepted here,
    /// same reasoning as ReportFilters.month being absent client-side. Only the
    /// scope/userId/teamId sales-scope filter applies, matching Vanilla's
    /// scopeFilter(ALL_APPS) wrapping thisMonthApps.
    ///
    /// "Login Count" = count of loans CREATED this month whose current Status is
    /// not Draft (Vanilla: status !== 'wip') — i.e. how many progressed past the
    /// initial Personal-Details/draft stage by now. This is NOT a count of
    /// literal login audit events and does NOT read LoanStatusHistory: Vanilla's
    /// own code comment (efin-app.js ~13092-13096, on the sibling `logins` var
    /// this reuses) says the previous 'EFIN-Login' tracking-entry lookup never
    /// matched because no such tracking entry is ever created, so Vanilla
    /// replaced it with this current-status check — the same
    /// terminal/non-terminal distinction already used by ActiveTime above.
    /// </summary>
    [HttpGet("target-achievement")]
    public async Task<IActionResult> TargetAchievement([FromQuery] string? scope, [FromQuery] int? userId, [FromQuery] int? teamId)
    {
        var now = DateTime.UtcNow;
        var monthStart = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
        var monthEnd   = monthStart.AddMonths(1);
        var monthKey   = $"{now.Year}-{now.Month:D2}";

        var q = LoanRepository.ApplyReportNarrowing(_db,
            LoanRepository.ApplyVisibilityScope(_db, _db.Loans.IncludeDeletedUsers(), CurrentUserId, CurrentUserRole),
            CurrentUserId, CurrentUserRole, scope, userId, teamId, null)
            .Where(l => l.CreatedAt >= monthStart && l.CreatedAt < monthEnd);

        var stats = await q.GroupBy(_ => 1).Select(g => new {
            LoginCount = g.Count(l => l.Status != Domain.Enums.LoanStatus.Draft),
            DisbCount  = g.Count(l => l.Status == Domain.Enums.LoanStatus.Disbursed),
            DisbAmt    = g.Where(l => l.Status == Domain.Enums.LoanStatus.Disbursed).Sum(l => l.ApprovedAmount ?? 0)
        }).FirstOrDefaultAsync();

        // Org-wide target row for this month (UserId/TeamId both null — the
        // only shape the Target Editor ever writes today). Falls back to the
        // same defaults as a freshly-added editor row (NEW_TARGET_DEFAULTS /
        // efin-app.js:12665) when no row exists yet for this month.
        var target = await _db.ReportTargets.FirstOrDefaultAsync(t =>
            t.TargetMonth == monthKey && t.UserId == null && t.TeamId == null && !t.IsDeleted);

        return Ok(ApiResponseDto<object>.Ok(new {
            month       = monthKey,
            achDisbAmt  = stats?.DisbAmt ?? 0,
            achLoginCnt = stats?.LoginCount ?? 0,
            achDisbCnt  = stats?.DisbCount ?? 0,
            tgtDisbAmt  = target?.DisbAmt ?? 5_000_000m,
            tgtLoginCnt = target?.LoginCount ?? 20,
            tgtDisbCnt  = target?.DisbCount ?? 8,
        }));
    }

    [HttpGet("disbursement")]
    public async Task<IActionResult> Disbursement([FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string? scope, [FromQuery] int? userId, [FromQuery] int? teamId, [FromQuery] LoanMS.Domain.Enums.LoanStatus? status)
    {
        var q = LoanRepository.ApplyReportNarrowing(_db,
            LoanRepository.ApplyVisibilityScope(_db, _db.Loans.IncludeDeletedUsers(), CurrentUserId, CurrentUserRole),
            CurrentUserId, CurrentUserRole, scope, userId, teamId, status)
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
    public async Task<IActionResult> RejectionAnalysis([FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string? scope, [FromQuery] int? userId, [FromQuery] int? teamId, [FromQuery] LoanMS.Domain.Enums.LoanStatus? status)
    {
        var q = LoanRepository.ApplyReportNarrowing(_db,
            LoanRepository.ApplyVisibilityScope(_db, _db.Loans.IncludeDeletedUsers(), CurrentUserId, CurrentUserRole),
            CurrentUserId, CurrentUserRole, scope, userId, teamId, status)
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
        var loans = await LoanRepository.ApplyVisibilityScope(_db, _db.Loans.IncludeDeletedUsers(), CurrentUserId, CurrentUserRole)
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
            var q = LoanRepository.ApplyVisibilityScope(_db, _db.Loans.IncludeDeletedUsers(), CurrentUserId, CurrentUserRole)
                .Where(l => l.Status == Domain.Enums.LoanStatus.Disbursed)
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
            var q = LoanRepository.ApplyVisibilityScope(_db, _db.Loans.IncludeDeletedUsers(), CurrentUserId, CurrentUserRole)
                .Include(l => l.Customer).Include(l => l.CreatedBy).AsQueryable();
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
    public async Task<IActionResult> Summary([FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string? scope, [FromQuery] int? userId, [FromQuery] int? teamId, [FromQuery] LoanMS.Domain.Enums.LoanStatus? status)
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "reports"))
            return Forbid();

        var now   = DateTime.UtcNow;
        // Kind MUST be Utc. new DateTime(y, m, 1) yields Kind=Unspecified, and
        // Npgsql refuses to write an Unspecified DateTime to a
        // 'timestamp with time zone' column -- it threw ArgumentException
        // ("only UTC is supported") on every call to this endpoint. Worse, the
        // ExceptionMiddleware maps ArgumentException to 400, so a server-side
        // bug was being reported to callers as a client error.
        var month = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);

        // Base query with date range
        // BUGFIX (confirmed real access-control bypass — Reports fix Phase 1,
        // most significant instance): this Summary() endpoint had FOUR
        // separate un-scoped queries (this one, plus loansWithDocs derived
        // from it, plus two entirely separate _db.Loans queries below —
        // monthlyDisbursements and topAgents — that didn't even reuse this
        // `q` at all). All four now go through the same centralized rule.
        var q = LoanRepository.ApplyReportNarrowing(_db,
            LoanRepository.ApplyVisibilityScope(_db, _db.Loans.IncludeDeletedUsers(), CurrentUserId, CurrentUserRole),
            CurrentUserId, CurrentUserRole, scope, userId, teamId, status);
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

        // BUGFIX (confirmed 500 at runtime — this endpoint threw
        // "The LINQ expression ... could not be translated. Additional
        // information: Translation of method 'string.Format' failed"): the
        // month label was being built with $"{...:D2}" INSIDE the .Select()
        // EF Core has to translate, and string.Format has no SQL translation
        // on ANY relational provider — SQLite and Npgsql alike — so this was
        // failing in production too, not just on the local dev database.
        //
        // Fixed with the same shape Monthly() above already uses: the
        // filtering, grouping and aggregates stay in SQL (unchanged, so no
        // extra rows are pulled), the result is materialised, and only the
        // string formatting — plus the ordering that depends on it — happens
        // in memory. Same rows, same property names, same order: the response
        // shape is byte-for-byte what it was before.
        var monthlyRaw = await LoanRepository.ApplyReportNarrowing(_db,
            LoanRepository.ApplyVisibilityScope(_db, _db.Loans.IncludeDeletedUsers(), CurrentUserId, CurrentUserRole),
            CurrentUserId, CurrentUserRole, scope, userId, teamId, status)
            .Where(l => l.Status == Domain.Enums.LoanStatus.Disbursed)
            .Where(l => from == null || l.DisbursedAt >= from.Value)
            .Where(l => to == null || l.DisbursedAt <= to.Value)
            .GroupBy(l => new { l.DisbursedAt!.Value.Year, l.DisbursedAt!.Value.Month })
            .Select(g => new {
                g.Key.Year,
                g.Key.Month,
                count = g.Count(),
                amount = g.Sum(l => l.ApprovedAmount ?? 0)
            })
            .ToListAsync();

        var monthlyDisbursements = monthlyRaw
            .Select(x => new {
                month = $"{x.Year}-{x.Month:D2}",
                count = x.count,
                amount = x.amount
            })
            .OrderBy(x => x.month)
            .ToList();

        var topAgents = await LoanRepository.ApplyReportNarrowing(_db,
            LoanRepository.ApplyVisibilityScope(_db, _db.Loans.IncludeDeletedUsers(), CurrentUserId, CurrentUserRole),
            CurrentUserId, CurrentUserRole, scope, userId, teamId, status)
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
