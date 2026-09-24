using System.Text.Json.Nodes;
using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace LoanMS.Infrastructure.Services;

/// <summary>
/// Permanent customer delete (owner decision 2026-09-23: "Customer Delete ko true
/// hard delete rakho"). Deletes explicitly, child tables first, inside ONE
/// transaction — it does not rely on database cascade rules, so a future
/// migration that changes a cascade cannot leave orphans, and a table that is
/// ever missed here fails loudly on its foreign key instead of silently.
///
/// Scope (from the live PostgreSQL FK graph + the no-FK references):
///   Customer → Loans (RESTRICT) → 18 loan-level tables (docs, obligations, history,
///   tracking, tasks, tickets→comments, income verification→months, Perfios,
///   salary slips, sanction, bank lines, offers, references, AI runs, lender
///   emails, payout claims [RESTRICT], assignment audit [SET NULL]);
///   Customer → BureauReports (no FK) → 8 bureau tables;
///   no-FK references: assignment logs of those tasks/tickets, notifications for
///   those claims/loan numbers, audit entries pointing at those ids, wizard audit
///   entries carrying the customer's email, InCred webhook-log entries.
/// Soft-deleted rows are included (IgnoreQueryFilters): this is a purge.
/// Stored document files are removed after the commit (a storage call cannot
/// be rolled back); any key that fails is reported, never silently dropped.
/// </summary>
public class CustomerDeletionService : ICustomerDeletionService
{
    private const string WebhookLogsKey = "incred_webhook_logs";
    private static readonly LoanStatus[] DeletableLoanStatuses = { LoanStatus.Closed, LoanStatus.Rejected };

    private readonly AppDbContext _db;
    private readonly IFileStorageService _storage;
    private readonly ILogger<CustomerDeletionService> _log;

    public CustomerDeletionService(AppDbContext db, IFileStorageService storage, ILogger<CustomerDeletionService> log)
    {
        _db = db; _storage = storage; _log = log;
    }

    public async Task<ApiResponseDto<CustomerDeletionResultDto>> DeletePermanentlyAsync(int customerId, CancellationToken ct = default)
    {
        var customer = await _db.Customers.IgnoreQueryFilters().AsNoTracking()
            .Where(c => c.Id == customerId).Select(c => new { c.Id, c.Email }).FirstOrDefaultAsync(ct);
        if (customer == null) return ApiResponseDto<CustomerDeletionResultDto>.Fail("Customer not found.");

        var loans = await _db.Loans.IgnoreQueryFilters().AsNoTracking().Where(l => l.CustomerId == customerId)
            .Select(l => new { l.Id, l.LoanNumber, l.Status, l.IsDeleted, l.IncredApplicationId }).ToListAsync(ct);

        // Existing business rule, unchanged: a customer with a live loan in progress
        // cannot be deleted — only Closed / Rejected (or already-removed) loans.
        if (loans.Any(l => !l.IsDeleted && !DeletableLoanStatuses.Contains(l.Status)))
            return ApiResponseDto<CustomerDeletionResultDto>.Fail("Cannot delete customer with active loans.");

        var loanIds = loans.Select(l => l.Id).ToList();
        var loanIdStrs = loanIds.Select(i => i.ToString()).ToList();
        var loanNumbers = loans.Select(l => l.LoanNumber).Where(n => !string.IsNullOrWhiteSpace(n)).ToList();
        var incredIds = loans.Select(l => l.IncredApplicationId).Where(n => !string.IsNullOrWhiteSpace(n)).Select(n => n!).ToList();

        var docs = await _db.LoanDocuments.IgnoreQueryFilters().AsNoTracking()
            .Where(d => loanIds.Contains(d.LoanId)).Select(d => new { d.Id, d.FilePath }).ToListAsync(ct);
        var docIdStrs = docs.Select(d => d.Id.ToString()).ToList();
        var claimIds = await _db.PayoutClaims.IgnoreQueryFilters().Where(p => loanIds.Contains(p.LoanId)).Select(p => p.Id).ToListAsync(ct);
        var claimIdStrs = claimIds.Select(i => i.ToString()).ToList();
        var taskIds = await _db.Tasks.IgnoreQueryFilters().Where(t => t.LoanId != null && loanIds.Contains(t.LoanId.Value)).Select(t => t.Id).ToListAsync(ct);
        var ticketIds = await _db.Tickets.IgnoreQueryFilters().Where(t => t.LoanId != null && loanIds.Contains(t.LoanId.Value)).Select(t => t.Id).ToListAsync(ct);
        var trackingIdStrs = (await _db.TrackingEntries.IgnoreQueryFilters().Where(t => loanIds.Contains(t.LoanId)).Select(t => t.Id).ToListAsync(ct)).Select(i => i.ToString()).ToList();
        var obligationIdStrs = (await _db.LoanObligations.IgnoreQueryFilters().Where(o => loanIds.Contains(o.LoanApplicationId)).Select(o => o.Id).ToListAsync(ct)).Select(i => i.ToString()).ToList();
        var ivIds = await _db.IncomeVerifications.IgnoreQueryFilters().Where(v => loanIds.Contains(v.LoanId)).Select(v => v.Id).ToListAsync(ct);
        var bureauIds = await _db.BureauReports.Where(b => b.CustomerId == customerId).Select(b => b.Id).ToListAsync(ct);
        var bureauAccountIds = await _db.BureauAccounts.Where(a => bureauIds.Contains(a.BureauReportId)).Select(a => a.Id).ToListAsync(ct);
        var taskIdStrs = taskIds.Select(i => i.ToString()).ToList();
        var ticketIdStrs = ticketIds.Select(i => i.ToString()).ToList();
        var email = (customer.Email ?? string.Empty).Trim().ToLower();

        var result = new CustomerDeletionResultDto
        {
            CustomerId = customerId, Loans = loans.Count, Documents = docs.Count,
            PayoutClaims = claimIds.Count, BureauReports = bureauIds.Count,
        };

        var strategy = _db.Database.CreateExecutionStrategy();
        await strategy.ExecuteAsync(async () =>
        {
            await using var tx = await _db.Database.BeginTransactionAsync(ct);

            // ── tasks / tickets and their no-FK assignment log ────────────────
            await _db.TicketComments.IgnoreQueryFilters().Where(c => ticketIds.Contains(c.TicketId)).ExecuteDeleteAsync(ct);
            await _db.AssignmentLogs.Where(a => (a.EntityType == "Task" && taskIds.Contains(a.EntityId))
                                              || (a.EntityType == "Ticket" && ticketIds.Contains(a.EntityId))).ExecuteDeleteAsync(ct);
            await _db.Tickets.IgnoreQueryFilters().Where(t => ticketIds.Contains(t.Id)).ExecuteDeleteAsync(ct);
            await _db.Tasks.IgnoreQueryFilters().Where(t => taskIds.Contains(t.Id)).ExecuteDeleteAsync(ct);

            // ── income / documents / credit review ───────────────────────────
            await _db.IncomeVerificationMonths.IgnoreQueryFilters().Where(m => ivIds.Contains(m.IncomeVerificationId)).ExecuteDeleteAsync(ct);
            await _db.IncomeVerifications.IgnoreQueryFilters().Where(v => loanIds.Contains(v.LoanId)).ExecuteDeleteAsync(ct);
            await _db.SalarySlipExtractions.IgnoreQueryFilters().Where(s => loanIds.Contains(s.LoanId)).ExecuteDeleteAsync(ct);
            await _db.PerfiosReports.IgnoreQueryFilters().Where(p => loanIds.Contains(p.LoanId)).ExecuteDeleteAsync(ct);
            await _db.LoanDocuments.IgnoreQueryFilters().Where(d => loanIds.Contains(d.LoanId)).ExecuteDeleteAsync(ct);
            await _db.LoanObligations.IgnoreQueryFilters().Where(o => loanIds.Contains(o.LoanApplicationId)).ExecuteDeleteAsync(ct);

            // ── remaining loan-level records ──────────────────────────────────
            await _db.LoanSanctionDetails.IgnoreQueryFilters().Where(x => loanIds.Contains(x.LoanId)).ExecuteDeleteAsync(ct);
            await _db.LoanStatusHistories.IgnoreQueryFilters().Where(x => loanIds.Contains(x.LoanId)).ExecuteDeleteAsync(ct);
            await _db.LoanOffers.IgnoreQueryFilters().Where(x => loanIds.Contains(x.LoanId)).ExecuteDeleteAsync(ct);
            await _db.LoanReferences.IgnoreQueryFilters().Where(x => loanIds.Contains(x.LoanId)).ExecuteDeleteAsync(ct);
            await _db.LoanBankLines.IgnoreQueryFilters().Where(x => loanIds.Contains(x.LoanId)).ExecuteDeleteAsync(ct);
            await _db.TrackingEntries.IgnoreQueryFilters().Where(x => loanIds.Contains(x.LoanId)).ExecuteDeleteAsync(ct);
            await _db.AiAgentRuns.IgnoreQueryFilters().Where(x => loanIds.Contains(x.LoanApplicationId)).ExecuteDeleteAsync(ct);
            await _db.LenderEmailThreadEntries.IgnoreQueryFilters().Where(x => loanIds.Contains(x.LoanApplicationId)).ExecuteDeleteAsync(ct);
            await _db.PayoutClaims.IgnoreQueryFilters().Where(p => loanIds.Contains(p.LoanId)).ExecuteDeleteAsync(ct);
            await _db.AssignmentAuditLogs.Where(a => (a.LoanApplicationId != null && loanIds.Contains(a.LoanApplicationId.Value))
                                                   || loanNumbers.Contains(a.LoanFrontendId)).ExecuteDeleteAsync(ct);

            // ── notifications (no FK: claim id / loan number in the text) ──────
            await _db.AppNotifications.IgnoreQueryFilters().Where(n => n.ClaimId != null && claimIdStrs.Contains(n.ClaimId)).ExecuteDeleteAsync(ct);
            foreach (var number in loanNumbers)
                await _db.AppNotifications.IgnoreQueryFilters().Where(n => n.Message != null && n.Message.Contains(number)).ExecuteDeleteAsync(ct);

            // ── audit entries that point at these records (no FK) ─────────────
            var customerIdStr = customerId.ToString();
            result.AuditEntries = await _db.AuditLogs.Where(a =>
                    (a.EntityName == "Customers" && a.EntityId == customerIdStr)
                 || (a.EntityName == "Loans" && a.EntityId != null && loanIdStrs.Contains(a.EntityId))
                 || (a.EntityName == "LoanDocument" && a.EntityId != null && docIdStrs.Contains(a.EntityId))
                 || ((a.EntityName == "PayoutClaim" || a.EntityName == "Payout") && a.EntityId != null && claimIdStrs.Contains(a.EntityId))
                 || (a.EntityName == "Tracking" && a.EntityId != null && trackingIdStrs.Contains(a.EntityId))
                 || (a.EntityName == "Obligations" && a.EntityId != null && obligationIdStrs.Contains(a.EntityId))
                 || (a.EntityName == "Tasks" && a.EntityId != null && taskIdStrs.Contains(a.EntityId))
                 || (a.EntityName == "Tickets" && a.EntityId != null && ticketIdStrs.Contains(a.EntityId)))
                .ExecuteDeleteAsync(ct);
            // Wizard saves are audited as "Wizard/draft|submit" with the form body,
            // which carries the customer's email (not masked) — the only stable key.
            if (email.Length > 5)
                result.AuditEntries += await _db.AuditLogs
                    .Where(a => a.EntityName == "Wizard" && a.NewValues != null && a.NewValues.ToLower().Contains(email))
                    .ExecuteDeleteAsync(ct);

            // ── the loans themselves ───────────────────────────────────────────
            await _db.Loans.IgnoreQueryFilters().Where(l => l.CustomerId == customerId).ExecuteDeleteAsync(ct);

            // ── bureau / CIBIL data (no FK to Customers) ──────────────────────
            await _db.BureauPaymentHistories.Where(x => bureauAccountIds.Contains(x.BureauAccountId)).ExecuteDeleteAsync(ct);
            await _db.BureauAccounts.Where(x => bureauIds.Contains(x.BureauReportId)).ExecuteDeleteAsync(ct);
            await _db.BureauEnquiries.Where(x => bureauIds.Contains(x.BureauReportId)).ExecuteDeleteAsync(ct);
            await _db.BureauAddresses.Where(x => bureauIds.Contains(x.BureauReportId)).ExecuteDeleteAsync(ct);
            await _db.BureauEmployments.Where(x => bureauIds.Contains(x.BureauReportId)).ExecuteDeleteAsync(ct);
            await _db.BureauMobileNumbers.Where(x => bureauIds.Contains(x.BureauReportId)).ExecuteDeleteAsync(ct);
            await _db.BureauEmailAddresses.Where(x => bureauIds.Contains(x.BureauReportId)).ExecuteDeleteAsync(ct);
            await _db.ScoreFactors.Where(x => bureauIds.Contains(x.BureauReportId)).ExecuteDeleteAsync(ct);
            await _db.BureauReports.Where(x => bureauIds.Contains(x.Id)).ExecuteDeleteAsync(ct);

            // ── the customer ───────────────────────────────────────────────────
            await _db.Customers.IgnoreQueryFilters().Where(c => c.Id == customerId).ExecuteDeleteAsync(ct);

            // ── InCred webhook log (JSON list in AppSettings) ──────────────────
            await PurgeWebhookLogAsync(incredIds, loanNumbers, ct);

            await tx.CommitAsync(ct);
        });

        // Files last: the database is now the source of truth. A failure here
        // leaves an unreferenced file, which is reported for a retry.
        foreach (var doc in docs)
        {
            if (string.IsNullOrWhiteSpace(doc.FilePath)) continue;
            var key = DocumentStorageKeys.ForLoanDocument(doc.FilePath);
            try { await _storage.DeleteAsync(key, ct); }
            catch (Exception ex)
            {
                _log.LogError(ex, "Customer {CustomerId} permanent delete: could not remove stored file {Key}", customerId, key);
                result.StorageFailures.Add(key);
            }
        }

        _log.LogWarning("Customer {CustomerId} permanently deleted: {Loans} loan(s), {Docs} document(s), {Claims} payout claim(s), {Bureau} bureau report(s), {Audit} audit entr(ies); {Failed} file(s) not removed",
            customerId, result.Loans, result.Documents, result.PayoutClaims, result.BureauReports, result.AuditEntries, result.StorageFailures.Count);

        var message = result.StorageFailures.Count == 0
            ? $"Customer permanently deleted ({result.Loans} loan(s), {result.Documents} document(s))."
            : $"Customer permanently deleted, but {result.StorageFailures.Count} stored file(s) could not be removed — see logs.";
        return ApiResponseDto<CustomerDeletionResultDto>.Ok(result, message);
    }

    private async Task PurgeWebhookLogAsync(List<string> incredIds, List<string> loanNumbers, CancellationToken ct)
    {
        if (incredIds.Count == 0 && loanNumbers.Count == 0) return;
        var setting = await _db.AppSettings.IgnoreQueryFilters().FirstOrDefaultAsync(s => s.Key == WebhookLogsKey && s.UserId == null, ct);
        if (setting == null || string.IsNullOrWhiteSpace(setting.Value)) return;
        if (JsonNode.Parse(setting.Value) is not JsonArray entries) return;

        var kept = new JsonArray();
        foreach (var e in entries)
        {
            var appId = e?["appId"]?.GetValue<string?>();
            var reference = e?["ref"]?.GetValue<string?>();
            if ((appId != null && incredIds.Contains(appId)) || (reference != null && loanNumbers.Contains(reference))) continue;
            kept.Add(e?.DeepClone());
        }
        if (kept.Count == entries.Count) return;
        setting.Value = kept.ToJsonString();
        setting.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
    }
}
