using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using LoanMS.Application.Interfaces;

namespace LoanMS.Infrastructure.Services;

/// <summary>
/// 🔴 CRITICAL — SLA breach automation (item #4) + Task follow-up automation
/// (item #9). Runs as an ASP.NET Core hosted BackgroundService — the
/// project has no other background-job infrastructure (no Hangfire/Quartz/
/// etc), so a plain BackgroundService with its own timer loop is the
/// safest, architecture-compatible choice rather than introducing a new
/// job-scheduling dependency for one feature.
///
/// SLA threshold: reuses the EXACT existing "sla-over" threshold already
/// defined in efin-app.js (144 hours / 6 days since the loan's last status
/// change) — not a new/invented number. Same threshold drives both the
/// notification and the follow-up task, since no separate task-specific
/// threshold exists anywhere in the project (avoids inventing one).
///
/// Terminal statuses excluded from SLA tracking: Rejected, Disbursed,
/// Closed — the closest backend-enum equivalent of the existing frontend's
/// terminal list (['disbursed','rejected','cancelled','ni'], which are
/// legacy string values that don't map 1:1 onto LoanStatus).
///
/// Dedupe: Loan.SlaBreachNotifiedAt is set once a breach is notified, and
/// only reset to null when the loan's Status actually changes (see
/// LoanService.UpdateStatusAsync) — so the same breach episode is never
/// notified twice, but a loan that breaches again in its NEXT status gets
/// a fresh notification. Task creation additionally checks for an existing
/// incomplete auto-generated task for the same loan before creating a new
/// one, so a scheduler re-run (or an overlapping run) can't create
/// duplicates.
/// </summary>
public class SlaAndTaskAutomationService : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<SlaAndTaskAutomationService> _logger;
    private readonly TimeSpan _interval;
    private const int SlaBreachHours = 144; // 6 days — matches efin-app.js's existing "sla-over" threshold exactly
    private const string AutoTaskMarker = "[Auto: SLA follow-up]";

    private static readonly LoanStatus[] TerminalStatuses = { LoanStatus.Rejected, LoanStatus.Disbursed, LoanStatus.Closed };

    public SlaAndTaskAutomationService(IServiceProvider services, ILogger<SlaAndTaskAutomationService> logger, IConfiguration config)
    {
        _services = services;
        _logger = logger;
        // Configurable interval — Automation:IntervalMinutes in appsettings /
        // ECS env var Automation__IntervalMinutes. Defaults to 15 minutes,
        // a reasonable balance for a 6-day breach threshold (no need to
        // check every minute) without being so infrequent that a breach
        // sits unnotified for hours after crossing the threshold.
        var minutes = config.GetValue<int?>("Automation:IntervalMinutes") ?? 15;
        if (minutes < 1) minutes = 15;
        _interval = TimeSpan.FromMinutes(minutes);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Small initial delay so this doesn't compete with the app's own
        // startup work (migrations, seeding) for DB connections.
        try { await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken); } catch (TaskCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunOnceAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // A failed run must never crash the host or block future
                // runs — log and retry on the next interval.
                _logger.LogError(ex, "[SlaAndTaskAutomation] Run failed — will retry on next interval.");
            }

            try { await Task.Delay(_interval, stoppingToken); }
            catch (TaskCanceledException) { break; }
        }
    }

    private async Task RunOnceAsync(CancellationToken ct)
    {
        using var scope = _services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var cutoff = DateTime.UtcNow.AddHours(-SlaBreachHours);

        // Candidate loans: non-terminal, not yet notified for their current
        // status. The actual "time in current status" (last LoanStatusHistory
        // entry, or CreatedAt if the loan has never changed status) is
        // evaluated in memory below — EF Core can't easily express
        // "latest child row per parent" as a single translatable query
        // alongside the rest of this filter without a more invasive
        // Repository change, and this job runs at most every few minutes
        // on a bounded (non-terminal, unnotified) candidate set, not the
        // whole Loans table.
        var candidates = await db.Loans
            .Where(l => !TerminalStatuses.Contains(l.Status) && l.SlaBreachNotifiedAt == null)
            .Select(l => new { l.Id, l.Status, l.CreatedAt, l.AssignedToUserId, l.CreatedByUserId, l.LoanNumber })
            .ToListAsync(ct);

        if (candidates.Count == 0) return;

        var loanIds = candidates.Select(c => c.Id).ToList();
        var lastHistoryByLoan = await db.LoanStatusHistories
            .Where(h => loanIds.Contains(h.LoanId))
            .GroupBy(h => h.LoanId)
            .Select(g => new { LoanId = g.Key, LastChangedAt = g.Max(h => h.CreatedAt) })
            .ToDictionaryAsync(x => x.LoanId, x => x.LastChangedAt, ct);

        var breached = candidates.Where(c =>
        {
            var statusChangedAt = lastHistoryByLoan.TryGetValue(c.Id, out var t) ? t : c.CreatedAt;
            return statusChangedAt <= cutoff;
        }).ToList();

        if (breached.Count == 0) return;

        var notifiedCount = 0;
        var tasksCreatedCount = 0;

        // PERFORMANCE FIX (productivity audit item #5): manager-lookup used
        // to run inside the foreach below — one query PER breached loan
        // (N+1-shaped). Batched into a single query up front instead,
        // keyed by responsible-user-id, so this scales the same way
        // regardless of how many loans breach in one run.
        var responsibleUserIds = breached.Select(c => c.AssignedToUserId ?? c.CreatedByUserId).Distinct().ToList();
        var managerByUserId = await db.Set<Team>()
            .Where(t => t.Type == "Sales" && t.TeamLeadUserId != null)
            .SelectMany(t => db.Set<TeamMember>()
                .Where(tm => tm.TeamId == t.Id && !tm.IsDeleted && responsibleUserIds.Contains(tm.UserId))
                .Select(tm => new { tm.UserId, ManagerId = t.TeamLeadUserId!.Value }))
            .ToDictionaryAsync(x => x.UserId, x => x.ManagerId, ct);

        foreach (var loan in breached)
        {
            ct.ThrowIfCancellationRequested();

            var responsibleUserId = loan.AssignedToUserId ?? loan.CreatedByUserId;
            var managerUserId = managerByUserId.TryGetValue(responsibleUserId, out var mgr) ? (int?)mgr : null;

            var loanEntity = await db.Loans.FirstOrDefaultAsync(l => l.Id == loan.Id, ct);
            if (loanEntity == null) continue; // deleted between the two queries — skip safely

            db.AppNotifications.Add(new AppNotification
            {
                Type = "sla_breach",
                Icon = "⏰",
                Message = $"{loan.LoanNumber} has been in {loan.Status} status for over {SlaBreachHours / 24} days — needs attention.",
                TargetUserId = responsibleUserId,
                CreatedAt = DateTime.UtcNow
            });

            if (managerUserId.HasValue && managerUserId.Value != responsibleUserId)
            {
                db.AppNotifications.Add(new AppNotification
                {
                    Type = "sla_breach_escalation",
                    Icon = "🔺",
                    Message = $"{loan.LoanNumber} (assigned to their team) has been in {loan.Status} status for over {SlaBreachHours / 24} days.",
                    TargetUserId = managerUserId.Value,
                    CreatedAt = DateTime.UtcNow
                });
            }

            // Task follow-up — dedupe against an existing INCOMPLETE
            // auto-generated task for this same loan (marker in the title),
            // so an overlapping/retried run can't pile up duplicates.
            var hasOpenAutoTask = await db.Tasks.AnyAsync(t =>
                t.LoanId == loan.Id && !t.IsCompleted && t.Title.Contains(AutoTaskMarker), ct);
            if (!hasOpenAutoTask)
            {
                db.Tasks.Add(new LoanTask
                {
                    LoanId = loan.Id,
                    Title = $"{AutoTaskMarker} {loan.LoanNumber} — follow up ({loan.Status}, {SlaBreachHours / 24}+ days)",
                    Description = $"Automatically created — this loan has remained in {loan.Status} status for more than {SlaBreachHours / 24} days.",
                    Priority = "High",
                    AssignedToUserId = responsibleUserId,
                    CreatedByUserId = loan.CreatedByUserId, // no system-user concept exists in this project — attributed to the loan's own creator, same convention used elsewhere for automated records
                    DueDate = DateTime.UtcNow.AddDays(2),
                    CreatedAt = DateTime.UtcNow
                });
                tasksCreatedCount++;
            }

            loanEntity.SlaBreachNotifiedAt = DateTime.UtcNow;
            notifiedCount++;
        }

        await db.SaveChangesAsync(ct);
        _logger.LogInformation(
            "[SlaAndTaskAutomation] Run complete — {Notified} loan(s) notified for SLA breach, {Tasks} follow-up task(s) created.",
            notifiedCount, tasksCreatedCount);

        await RunReportDigestIfDueAsync(db, ct);
    }

    /// <summary>
    /// 🟡 Report Automation (item #14) — technical capability only. No
    /// recipients or cadence are hardcoded/invented: this stays a silent
    /// no-op until an Admin configures a recipient list via the existing
    /// generic AppSettings store (same POST /api/settings mechanism already
    /// used for webhook_url, ai_agent_config, etc — key
    /// "report_digest_recipients", a comma-separated email list). Once
    /// configured, sends a once-per-day summary (loan counts by status) via
    /// the existing IEmailService — no new email/notification architecture.
    /// REQUIRES BUSINESS CONFIRMATION: actual recipients and desired cadence
    /// (this defaults to daily, the simplest interpretation, since no
    /// cadence is specified anywhere in the project).
    /// </summary>
    private async Task RunReportDigestIfDueAsync(AppDbContext db, CancellationToken ct)
    {
        var recipientsCsv = await db.AppSettings
            .Where(s => s.Key == "report_digest_recipients" && !s.IsDeleted)
            .Select(s => s.Value)
            .FirstOrDefaultAsync(ct);
        if (string.IsNullOrWhiteSpace(recipientsCsv)) return; // not configured — stay silent, do nothing

        var lastSentStr = await db.AppSettings
            .Where(s => s.Key == "report_digest_last_sent" && !s.IsDeleted)
            .Select(s => s.Value)
            .FirstOrDefaultAsync(ct);
        if (DateTime.TryParse(lastSentStr, out var lastSent) && (DateTime.UtcNow - lastSent).TotalHours < 20)
            return; // already sent within the last ~day — avoid double-sends across overlapping runs

        var recipients = recipientsCsv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (recipients.Length == 0) return;

        var counts = await db.Loans
            .Where(l => !l.IsDeleted)
            .GroupBy(l => l.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);

        var rows = string.Join("", counts.Select(c => $"<tr><td style='padding:4px 12px'>{c.Status}</td><td style='padding:4px 12px'>{c.Count}</td></tr>"));
        var html = $"<h3>LoanMS — Daily Summary</h3><table>{rows}</table><p style='color:#888;font-size:12px'>Automated report — configured via Settings (report_digest_recipients).</p>";

        try
        {
            var emailService = _services.CreateScope().ServiceProvider.GetRequiredService<IEmailService>();
            foreach (var to in recipients)
                await emailService.SendAsync(to, to, "LoanMS Daily Summary", html);

            var existing = await db.AppSettings.FirstOrDefaultAsync(s => s.Key == "report_digest_last_sent" && !s.IsDeleted, ct);
            if (existing != null) { existing.Value = DateTime.UtcNow.ToString("o"); existing.UpdatedAt = DateTime.UtcNow; }
            else db.AppSettings.Add(new AppSetting { Key = "report_digest_last_sent", Value = DateTime.UtcNow.ToString("o"), Category = "reports", CreatedAt = DateTime.UtcNow });
            await db.SaveChangesAsync(ct);
            _logger.LogInformation("[SlaAndTaskAutomation] Report digest sent to {Count} recipient(s).", recipients.Length);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "[SlaAndTaskAutomation] Report digest send failed — will retry on next run.");
        }
    }
}
