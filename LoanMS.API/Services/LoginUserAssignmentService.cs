using System.Text.Json;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Services;

/// <summary>
/// Deterministic Login-User auto-assignment. See <see cref="ILoginUserAssignmentService"/>.
///
/// Selection algorithm (all server-side, never client-influenced):
///   1. Read the application's Location (loan.LocationId). No location → no
///      auto-assignment (left for manual routing).
///   2. Candidate pool = users with Role == LoginTeam, IsActive, not deleted,
///      eligible for that Location — eligible meaning the user has the Location
///      in their many-to-many UserLocations set OR as their primary
///      User.LocationId (same two sources ApplyVisibilityScope trusts).
///   3. Exclude nobody else beyond inactive/suspended (IsActive == false) —
///      there is no separate "on leave" flag in this schema, so IsActive is the
///      single eligibility switch (documented as a known limitation).
///   4. Workload = count of that user's currently in-flight loans (Submitted,
///      UnderReview, Approved, OnHold, Decision, Acceptance) — terminal
///      (Rejected/Disbursed/Closed) and Draft loans do not count, and the
///      loan being assigned is excluded so it never counts against its own
///      assignee.
///   5. Pick the least-loaded candidate. Ties are broken by least-recently-
///      assigned (oldest most-recent auto/manual assignment wins; never-
///      assigned users sort first), then lowest UserId — so the outcome is
///      fully deterministic and reproducible.
/// </summary>
public sealed class LoginUserAssignmentService : ILoginUserAssignmentService
{
    private readonly AppDbContext _db;
    public LoginUserAssignmentService(AppDbContext db) => _db = db;

    // In-flight statuses that count toward a Login User's active workload.
    private static readonly LoanStatus[] _activeStatuses =
    {
        LoanStatus.Submitted, LoanStatus.UnderReview, LoanStatus.Approved,
        LoanStatus.OnHold, LoanStatus.Decision, LoanStatus.Acceptance
    };

    public async Task<LoginAssignmentResult> AutoAssignLoginUserAsync(Loan loan)
    {
        // Never override an existing assignment (e.g. resuming a draft that was
        // already routed, or an Admin having set it manually).
        if (loan.LoginUserId.HasValue && loan.LoginUserId.Value > 0)
            return new LoginAssignmentResult(false, loan.LoginUserId, null, false,
                "Login User already assigned — auto-assignment skipped.");

        if (!loan.LocationId.HasValue)
            return await LogUnassignedAsync(loan, "No Location on application — cannot auto-assign a Login User.");

        var locationId = loan.LocationId.Value;

        // Step 2/3 — eligible active Login Users at this Location.
        var eligible = await _db.Users
            .Where(u => u.Role == UserRole.LoginTeam && u.IsActive && !u.IsDeleted &&
                        (u.LocationId == locationId ||
                         _db.UserLocations.Any(ul => ul.UserId == u.Id && ul.LocationId == locationId && !ul.IsDeleted)))
            .Select(u => new { u.Id, u.FullName })
            .ToListAsync();

        if (eligible.Count == 0)
            return await LogUnassignedAsync(loan,
                $"No eligible active Login User mapped to Location {locationId}.");

        var eligibleIds = eligible.Select(e => e.Id).ToList();

        // Step 4 — current in-flight workload per eligible Login User (excludes this loan).
        var workload = (await _db.Loans
                .Where(l => !l.IsDeleted && l.Id != loan.Id && l.LoginUserId != null &&
                            eligibleIds.Contains(l.LoginUserId.Value) &&
                            _activeStatuses.Contains(l.Status))
                .GroupBy(l => l.LoginUserId!.Value)
                .Select(g => new { UserId = g.Key, Count = g.Count() })
                .ToListAsync())
            .ToDictionary(x => x.UserId, x => x.Count);

        // Tie-break input — most-recent prior assignment per eligible user.
        var lastAssigned = (await _db.AssignmentAuditLogs
                .Where(a => a.AssignedToUserId != null && eligibleIds.Contains(a.AssignedToUserId.Value))
                .GroupBy(a => a.AssignedToUserId!.Value)
                .Select(g => new { UserId = g.Key, Last = g.Max(a => a.AssignedAt) })
                .ToListAsync())
            .ToDictionary(x => x.UserId, x => x.Last);

        // Step 5 — deterministic ordering: least workload, then least-recently
        // assigned (DateTime.MinValue for never-assigned so they sort first),
        // then lowest UserId as the final stable tiebreak.
        var ranked = eligible
            .Select(e => new
            {
                e.Id,
                e.FullName,
                Load = workload.TryGetValue(e.Id, out var w) ? w : 0,
                Last = lastAssigned.TryGetValue(e.Id, out var t) ? t : DateTime.MinValue
            })
            .OrderBy(x => x.Load).ThenBy(x => x.Last).ThenBy(x => x.Id)
            .ToList();

        var chosen = ranked[0];
        var minLoad = ranked[0].Load;
        var tieBreak = ranked.Count(x => x.Load == minLoad) > 1;

        loan.LoginUserId = chosen.Id;

        var candidatesJson = JsonSerializer.Serialize(
            ranked.Select(x => new { userId = x.Id, name = x.FullName, workload = x.Load }));

        _db.AssignmentAuditLogs.Add(new AssignmentAuditLog
        {
            LoanApplicationId  = loan.Id,
            LoanFrontendId     = loan.LoanNumber,
            Location           = locationId.ToString(),
            LoanType           = loan.LoanType.ToString(),
            AssignedToUserId   = chosen.Id,
            AssignedToUserName = chosen.FullName,
            AssignedByName     = "System (Auto)",
            Method             = "auto",
            TieBreak           = tieBreak,
            Reason             = $"Auto-assigned by Location + least workload ({minLoad} active" +
                                 (tieBreak ? ", least-recently-assigned tiebreak" : "") + ").",
            CandidatesJson     = candidatesJson,
            AssignedAt         = DateTime.UtcNow,
            CreatedAt          = DateTime.UtcNow
        });

        return new LoginAssignmentResult(true, chosen.Id, chosen.FullName, tieBreak,
            $"Assigned to {chosen.FullName} (workload {minLoad}).");
    }

    private async Task<LoginAssignmentResult> LogUnassignedAsync(Loan loan, string reason)
    {
        _db.AssignmentAuditLogs.Add(new AssignmentAuditLog
        {
            LoanApplicationId  = loan.Id,
            LoanFrontendId     = loan.LoanNumber,
            Location           = loan.LocationId?.ToString(),
            LoanType           = loan.LoanType.ToString(),
            AssignedToUserId   = null,
            AssignedToUserName = null,
            AssignedByName     = "System (Auto)",
            Method             = "unassigned",
            TieBreak           = false,
            Reason             = reason,
            AssignedAt         = DateTime.UtcNow,
            CreatedAt          = DateTime.UtcNow
        });
        // Awaitable no-op keeps the method async/uniform with the assign path.
        await Task.CompletedTask;
        return new LoginAssignmentResult(false, null, null, false, reason);
    }
}
