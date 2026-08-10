using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── Unified Action Queue (productivity audit, P0) ────────────────────────────
// Combines four data sources that already exist server-side individually
// (SLA-breach tracking, Wizard draft staleness, missing-document detection,
// pending payout claims) into one prioritized "what needs my attention right
// now" view. No new business logic — every check here reuses the exact same
// rules already implemented and shipped elsewhere in this project (see each
// section's own comment for the specific source). Purely additive/read-only.
[Authorize]
public class DashboardController : BaseController
{
    private readonly AppDbContext _db;
    private readonly ILoanService _loanService;

    private static readonly LoanStatus[] TerminalStatuses = { LoanStatus.Rejected, LoanStatus.Disbursed, LoanStatus.Closed };
    private const int SlaBreachHours = 144; // same threshold as SlaAndTaskAutomationService — not re-invented here

    public DashboardController(AppDbContext db, ILoanService loanService)
    {
        _db = db;
        _loanService = loanService;
    }

    [HttpGet("action-queue")]
    public async Task<IActionResult> GetActionQueue()
    {
        // Step 1 — the caller's visible loan-id set, via the EXACT same
        // role-based scoping every other loan read already goes through
        // (ILoanService.GetAllAsync → ILoanRepository.ApplyVisibilityScope).
        // Nothing in this controller invents a second visibility rule.
        var visibleLoansResult = await _loanService.GetAllAsync(
            new LoanFilterDto { Page = 1, PageSize = 500, SortBy = "CreatedAt", SortDir = "desc" },
            CurrentUserId, CurrentUserRole);
        var visibleLoanIds = visibleLoansResult.Data?.Items.Select(l => l.Id).ToList() ?? new List<int>();

        if (visibleLoanIds.Count == 0)
        {
            return Ok(ApiResponseDto<object>.Ok(new
            {
                slaBreached = new List<object>(),
                staleDrafts = new List<object>(),
                missingDocuments = new List<object>(),
                pendingPayoutClaims = new List<object>()
            }));
        }

        // ── SLA-breached (same rule as SlaAndTaskAutomationService) ──────────
        var candidates = await _db.Loans
            .Where(l => visibleLoanIds.Contains(l.Id) && !TerminalStatuses.Contains(l.Status))
            .Select(l => new { l.Id, l.LoanNumber, l.Status, l.CreatedAt })
            .ToListAsync();
        var candidateIds = candidates.Select(c => c.Id).ToList();
        var lastHistoryByLoan = await _db.LoanStatusHistories
            .Where(h => candidateIds.Contains(h.LoanId))
            .GroupBy(h => h.LoanId)
            .Select(g => new { LoanId = g.Key, LastChangedAt = g.Max(h => h.CreatedAt) })
            .ToDictionaryAsync(x => x.LoanId, x => x.LastChangedAt);
        var cutoff = DateTime.UtcNow.AddHours(-SlaBreachHours);
        var slaBreached = candidates
            .Select(c => new { c.Id, c.LoanNumber, Status = c.Status.ToString(), StatusChangedAt = lastHistoryByLoan.TryGetValue(c.Id, out var t) ? t : c.CreatedAt })
            .Where(c => c.StatusChangedAt <= cutoff)
            .Select(c => new { loanId = c.Id, loanNumber = c.LoanNumber, status = c.Status, daysOverdue = Math.Round((DateTime.UtcNow - c.StatusChangedAt).TotalDays, 1) })
            .OrderByDescending(c => c.daysOverdue)
            .Take(20)
            .ToList();

        // ── Stale drafts (same 7-day rule as WizardController.ListDrafts) ───
        var staleDrafts = await _db.Loans
            .Where(l => visibleLoanIds.Contains(l.Id) && l.Status == LoanStatus.Draft)
            .Include(l => l.Customer)
            .Select(l => new { l.Id, l.Customer.FullName, l.UpdatedAt, l.CreatedAt })
            .ToListAsync();
        var staleDraftsResult = staleDrafts
            .Select(d => new { d.Id, Label = string.IsNullOrWhiteSpace(d.FullName) ? "Untitled application" : d.FullName, LastTouched = d.UpdatedAt ?? d.CreatedAt })
            .Where(d => (DateTime.UtcNow - d.LastTouched).TotalDays > 7)
            .Select(d => new { loanId = d.Id, label = d.Label, daysSinceUpdate = Math.Round((DateTime.UtcNow - d.LastTouched).TotalDays, 1) })
            .OrderByDescending(d => d.daysSinceUpdate)
            .Take(20)
            .ToList();

        // ── Missing documents (same rule as LoansController.GetMissingDocuments,
        //    applied here to Submitted/UnderReview loans in one batch instead
        //    of one-loan-at-a-time) ──────────────────────────────────────────
        var activeLoans = await _db.Loans
            .Where(l => visibleLoanIds.Contains(l.Id) && (l.Status == LoanStatus.Submitted || l.Status == LoanStatus.UnderReview))
            .Include(l => l.Customer)
            .Select(l => new { l.Id, l.LoanNumber, EmploymentType = l.Customer.EmploymentType })
            .ToListAsync();
        var activeLoanIds = activeLoans.Select(l => l.Id).ToList();
        var uploadedTypesByLoan = await _db.Set<LoanDocument>()
            .Where(d => activeLoanIds.Contains(d.LoanId) && !d.IsDeleted)
            .GroupBy(d => d.LoanId)
            .Select(g => new { LoanId = g.Key, Types = g.Select(d => d.DocumentType).ToList() })
            .ToDictionaryAsync(x => x.LoanId, x => x.Types);
        var missingDocuments = activeLoans
            .Select(l =>
            {
                var uploaded = uploadedTypesByLoan.TryGetValue(l.Id, out var t) ? t : new List<string>();
                var missing = new List<string>();
                if (!uploaded.Contains("salary_slip")) missing.Add("salary_slip");
                if (!uploaded.Contains("bank_statement")) missing.Add("bank_statement");
                if (l.EmploymentType is "Self-Employed" or "Professional")
                {
                    if (!uploaded.Contains("itr")) missing.Add("itr");
                    if (!uploaded.Contains("gst")) missing.Add("gst");
                }
                return new { l.Id, l.LoanNumber, Missing = missing };
            })
            .Where(l => l.Missing.Count > 0)
            .Select(l => new { loanId = l.Id, loanNumber = l.LoanNumber, missingTypes = l.Missing })
            .Take(20)
            .ToList();

        // ── Pending payout claims assigned to the caller ─────────────────────
        var pendingPayoutClaims = await _db.PayoutClaims
            .Where(p => p.ClaimedByUserId == CurrentUserId && p.Status == "Pending")
            .OrderByDescending(p => p.CreatedAt)
            .Select(p => new { claimId = p.Id, loanApac = p.Loan.LoanNumber, claimAmount = p.ClaimAmount, submittedDaysAgo = Math.Round((DateTime.UtcNow - p.CreatedAt).TotalDays, 1) })
            .Take(20)
            .ToListAsync();

        return Ok(ApiResponseDto<object>.Ok(new
        {
            slaBreached,
            staleDrafts = staleDraftsResult,
            missingDocuments,
            pendingPayoutClaims,
            totalActionItems = slaBreached.Count + staleDraftsResult.Count + missingDocuments.Count + pendingPayoutClaims.Count
        }));
    }
}
