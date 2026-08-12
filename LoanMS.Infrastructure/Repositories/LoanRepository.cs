using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Repositories;

// ── Loan Repository ───────────────────────────────────────────────────────────
public class LoanRepository : GenericRepository<Loan>, ILoanRepository
{
    public LoanRepository(AppDbContext ctx) : base(ctx) { }

    public async Task<Loan?> GetWithDetailsAsync(int id, int? currentUserId = null, string? currentUserRole = null)
    {
        var query = _set
            .Include(l => l.Customer)
            .Include(l => l.CreatedBy)
            .Include(l => l.AssignedTo)
            .Include(l => l.LoginUser)
            .Include(l => l.OpsManager)
            .Include(l => l.Location)
            .Include(l => l.Dsa)
            .Include(l => l.Partner)
            .Include(l => l.BankLines.OrderBy(b => b.Id))
            .Include(l => l.References.OrderBy(r => r.RefNumber))
            .Include(l => l.SanctionDetail)
            .Include(l => l.StatusHistory.OrderByDescending(h => h.CreatedAt))
                .ThenInclude(h => h.ChangedBy)
            .Include(l => l.Documents)
            .AsQueryable();

        // Phase 2B — same visibility scope as the list endpoint, applied here so
        // that fetching a loan directly by id (e.g. by guessing/incrementing the
        // loanId in the URL) is blocked for anyone outside the caller's scope.
        // currentUserId is only null for internal callers (post-create/update
        // refetch, AI service) that intentionally need the unrestricted record.
        if (currentUserId.HasValue)
            query = ApplyVisibilityScope(_ctx, query, currentUserId.Value, currentUserRole);

        return await query.FirstOrDefaultAsync(l => l.Id == id);
    }

    /// <summary>
    /// Single source of truth for role-based Loan visibility. Applied to
    /// every loan read surface: list, search/filter, dashboard/recent loans,
    /// and detail-by-id. This is server-side query scoping — the frontend
    /// never decides who can see what.
    ///   Sales            -> own created loans + loans currently assigned to them
    ///   Dsa              -> own DSA cases (linked via DsaPartner.LinkedUserId)
    ///                       PLUS every Partner's cases where that Partner is
    ///                       mapped under this DSA (DsaPartner.MappedDsaId)
    ///   Partner          -> loans whose PartnerId matches the DsaPartner record linked to this user
    ///   Manager          -> team-MEMBERSHIP based (verified against the reference Odoo
    ///                       project): every loan whose creator/assignee belongs to a
    ///                       Sales-type Team this user leads or is a member of
    ///   TeamLeader       -> same rule as Manager (Sales-team membership)
    ///   LoginTeam        -> own personally-assigned processing queue only (Loan.LoginUserId)
    ///   OperationManager -> whole Login-type Team's queue (team-membership derivation,
    ///                       same mechanism as Manager/TeamLeader, applied to Login teams)
    ///   LocationHead     -> every loan at their assigned Location (User.LocationId),
    ///                       independent of team — cuts across Source/Process/Operation
    ///   ProductTeam      -> no Loan visibility at all — real access is over the
    ///                       configuration modules (Offers/Lender/DSA/Partner
    ///                       management), not loans — see DsaController,
    ///                       BanksController, ProductOfferMatrixController
    ///   Accounts         -> financially-relevant applications only (Approved/Disbursed)
    ///   Admin            -> unrestricted
    ///   anything else / unrecognized role -> no loans visible
    ///
    /// Made internal static (ctx passed in explicitly instead of using the
    /// instance's _ctx) so CustomerRepository, in the same assembly, can
    /// reuse this exact rule set to scope customers via their loans, instead
    /// of re-implementing the Sales/Dsa/Partner/Manager rules a second time.
    /// </summary>
    internal static IQueryable<Loan> ApplyVisibilityScope(AppDbContext ctx, IQueryable<Loan> query, int currentUserId, string? currentUserRole)
    {
        var role = currentUserRole ?? string.Empty;

        if (string.Equals(role, "Admin", StringComparison.OrdinalIgnoreCase))
            return query;

        if (string.Equals(role, "Sales", StringComparison.OrdinalIgnoreCase))
            return query.Where(l => l.CreatedByUserId == currentUserId || l.AssignedToUserId == currentUserId);

        if (string.Equals(role, "Dsa", StringComparison.OrdinalIgnoreCase))
            // Own DSA cases: never compare currentUserId directly to
            // Loan.DsaId — DsaId is a DsaPartner record id, not a User id.
            // Resolve via the linked user.
            //
            // PLUS (added per business owner): if the loan's Partner is
            // mapped under this DSA (DsaPartner.MappedDsaId — the Partner
            // Management "mapped DSA" field), the DSA also sees that
            // Partner's cases. Rule as specified: a Partner with no mapped
            // DSA is unaffected by this at all (no location or other
            // condition involved) — only linkage matters.
            return query.Where(l =>
                (l.DsaId != null && l.Dsa != null && l.Dsa.LinkedUserId == currentUserId) ||
                (l.PartnerId != null && l.Partner != null && l.Partner.MappedDsa != null &&
                 l.Partner.MappedDsa.LinkedUserId == currentUserId));

        if (string.Equals(role, "Partner", StringComparison.OrdinalIgnoreCase))
            // Same rule for Partner: never compare currentUserId directly to Loan.PartnerId.
            return query.Where(l => l.PartnerId != null && l.Partner != null && l.Partner.LinkedUserId == currentUserId);

        // Manager / TeamLeader (Sales hierarchy) — corrected to a
        // team-MEMBERSHIP rule, verified against the reference Odoo project's
        // actual security.xml record rule: `salles_id in user.team_sales_ids`
        // (Team Leader/Manager see every loan tagged to a Sales Team they
        // belong to — as leader OR member — not just loans at "their"
        // Location). LoanMS's Loan entity has no direct Sales-Team tag field
        // (unlike Odoo's `salles_id`), so this is derived at query time:
        // a loan counts if its creator or assignee is themselves a member
        // (or the lead) of any Sales-type Team the current user also
        // belongs to.
        if (string.Equals(role, "Manager", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(role, "TeamLeader", StringComparison.OrdinalIgnoreCase))
        {
            var mySalesTeamIds = ctx.Set<Team>()
                .Where(t => t.Type == "Sales" &&
                    (t.TeamLeadUserId == currentUserId ||
                     ctx.Set<TeamMember>().Any(tm => tm.TeamId == t.Id && tm.UserId == currentUserId && !tm.IsDeleted)))
                .Select(t => t.Id);

            var teamUserIds = ctx.Set<TeamMember>()
                .Where(tm => mySalesTeamIds.Contains(tm.TeamId) && !tm.IsDeleted)
                .Select(tm => tm.UserId)
                .Union(ctx.Set<Team>()
                    .Where(t => mySalesTeamIds.Contains(t.Id) && t.TeamLeadUserId != null)
                    .Select(t => t.TeamLeadUserId!.Value));

            return query.Where(l =>
                teamUserIds.Contains(l.CreatedByUserId) ||
                (l.AssignedToUserId.HasValue && teamUserIds.Contains(l.AssignedToUserId.Value)));
        }

        // LoginTeam — corrected per the final spec, now that Loan.LoginUserId
        // exists: an individual Login Team member sees only their OWN
        // personally-assigned processing queue (mirrors the Sales rule's
        // AssignedToUserId check, but for the Login/processing stage).
        if (string.Equals(role, "LoginTeam", StringComparison.OrdinalIgnoreCase))
            return query.Where(l => l.LoginUserId == currentUserId);

        // OperationManager — corrected per the final spec: sees every loan
        // assigned (LoginUserId) to any member of an Operation/Login-type
        // Team this user leads or belongs to — i.e. supervises their whole
        // team's queue, not just their own. Same team-membership derivation
        // used for Manager/TeamLeader above, applied to Login-type teams.
        if (string.Equals(role, "OperationManager", StringComparison.OrdinalIgnoreCase))
        {
            var myLoginTeamIds = ctx.Set<Team>()
                .Where(t => t.Type == "Login" &&
                    (t.TeamLeadUserId == currentUserId ||
                     ctx.Set<TeamMember>().Any(tm => tm.TeamId == t.Id && tm.UserId == currentUserId && !tm.IsDeleted)))
                .Select(t => t.Id);

            var teamUserIds = ctx.Set<TeamMember>()
                .Where(tm => myLoginTeamIds.Contains(tm.TeamId) && !tm.IsDeleted)
                .Select(tm => tm.UserId)
                .Union(ctx.Set<Team>()
                    .Where(t => myLoginTeamIds.Contains(t.Id) && t.TeamLeadUserId != null)
                    .Select(t => t.TeamLeadUserId!.Value));

            return query.Where(l => l.LoginUserId.HasValue && teamUserIds.Contains(l.LoginUserId.Value));
        }

        // LocationHead — corrected per the final spec, now that User.LocationId
        // exists: sees every loan at their assigned Location, independent of
        // team — cuts across Source/Process/Operation, unlike Manager/
        // TeamLeader/OperationManager which are all team-scoped.
        if (string.Equals(role, "LocationHead", StringComparison.OrdinalIgnoreCase))
        {
            var myLocationId = ctx.Set<User>()
                .Where(u => u.Id == currentUserId)
                .Select(u => u.LocationId)
                .FirstOrDefault();
            if (myLocationId == null)
                return query.Where(l => false);
            return query.Where(l => l.LocationId == myLocationId);
        }

        // ProductTeam: no existing field ties a User to a specific
        // product/LoanType (unlike LocationHead, which now has a real
        // Location link), so — per the project owner's explicit decision —
        // this intentionally falls through to the same "no loans visible"
        // rule as any other unrecognized role below. ProductTeam's real
        // access is over the configuration modules (Offers/Lender/DSA/
        // Partner management), not Loan visibility — see DsaController,
        // BanksController, ProductOfferMatrixController.

        // Accounts — per the final Role & Access spec: financially-relevant
        // applications only (a loan becomes relevant to Accounts once
        // there's actually a payout to reconcile). No team/location scope —
        // Accounts is explicitly a cross-location finance function (same
        // convention already used for PayoutController's _selfOnlyRoles,
        // which deliberately excludes Accounts from the self-only claim
        // scoping for the same reason).
        if (string.Equals(role, "Accounts", StringComparison.OrdinalIgnoreCase))
            return query.Where(l => l.Status == LoanStatus.Approved || l.Status == LoanStatus.Disbursed);

        // Unrelated / unrecognized roles: no loan should be visible.
        return query.Where(l => false);
    }

    /// <summary>
    /// Phase 3A — "can this user act on this loan" check for Update/UpdateStatus/
    /// Submit/Approve/Reject/Delete. Deliberately reuses ApplyVisibilityScope
    /// (the same rule set that gates the list/detail endpoints) instead of a
    /// second, separate authorization check — one rule set, one place to change it.
    /// </summary>
    public async Task<bool> HasAccessAsync(int loanId, int currentUserId, string? currentUserRole)
    {
        var query = ApplyVisibilityScope(_ctx, _set.AsQueryable(), currentUserId, currentUserRole);
        return await query.AnyAsync(l => l.Id == loanId);
    }

    public async Task<bool> LocationExistsAsync(int locationId)
    {
        return await _ctx.Set<LoanMS.Domain.Entities.Location>().AnyAsync(l => l.Id == locationId && !l.IsDeleted);
    }

    public async Task ReplaceBankLinesAsync(int loanId, List<LoanBankLine> newLines)
    {
        var existing = await _ctx.Set<LoanBankLine>().Where(b => b.LoanId == loanId && !b.IsDeleted).ToListAsync();
        foreach (var line in existing)
        {
            line.IsDeleted = true;
            line.UpdatedAt = DateTime.UtcNow;
        }
        foreach (var line in newLines)
        {
            line.LoanId = loanId;
            line.CreatedAt = DateTime.UtcNow;
            _ctx.Set<LoanBankLine>().Add(line);
        }
        await _ctx.SaveChangesAsync();
    }

    public async Task ReplaceReferencesAsync(int loanId, List<LoanReference> newRefs)
    {
        // Same whole-table-replace convention as ReplaceBankLinesAsync —
        // simpler and safer than diffing individual row ids for a small,
        // always-fully-resubmitted set (2 references, edited together as
        // one form section in saveEditDetail()).
        var existing = await _ctx.Set<LoanReference>().Where(r => r.LoanId == loanId && !r.IsDeleted).ToListAsync();
        foreach (var r in existing)
        {
            r.IsDeleted = true;
            r.UpdatedAt = DateTime.UtcNow;
        }
        foreach (var r in newRefs)
        {
            r.LoanId = loanId;
            r.CreatedAt = DateTime.UtcNow;
            _ctx.Set<LoanReference>().Add(r);
        }
        await _ctx.SaveChangesAsync();
    }

    public async Task<PagedResultDto<LoanListDto>> GetPagedAsync(LoanFilterDto filter, int? currentUserId = null, string? currentUserRole = null)
    {
        var query = _set
            .Include(l => l.Customer)
            .Include(l => l.CreatedBy)
            .Include(l => l.AssignedTo)
            .AsQueryable();

        // Role-based scoping — enforced on the server, not the client.
        if (currentUserId.HasValue)
            query = ApplyVisibilityScope(_ctx, query, currentUserId.Value, currentUserRole);

        query = ApplyListFilters(_ctx, query, filter);

        var total = await query.CountAsync();
        var items = await query
            .Skip((filter.Page - 1) * filter.PageSize)
            .Take(filter.PageSize)
            .Select(l => new LoanListDto
            {
                Id              = l.Id,
                LoanNumber      = l.LoanNumber,
                LoanType        = l.LoanType.ToString(),
                Status          = l.Status.ToString(),
                RequestedAmount = l.RequestedAmount,
                ApprovedAmount  = l.ApprovedAmount,
                InterestRate    = l.InterestRate,
                TenureMonths    = l.TenureMonths,
                CustomerName    = l.Customer.FullName,
                CustomerPhone   = l.Customer.Phone,
                CreatedByName   = l.CreatedBy.FullName,
                AssignedToName  = l.AssignedTo != null ? l.AssignedTo.FullName : null,
                LoginUserName   = l.LoginUser  != null ? l.LoginUser.FullName  : null,
                RiskGrade       = _ctx.Set<BureauReport>()
                                    .Where(b => b.CustomerId == l.CustomerId)
                                    .OrderByDescending(b => b.ScoreGeneratedDate)
                                    .Select(b => b.RiskGrade)
                                    .FirstOrDefault(),
                CreatedAt       = l.CreatedAt
            })
            .ToListAsync();

        return new PagedResultDto<LoanListDto>
        {
            Items = items, TotalCount = total, Page = filter.Page, PageSize = filter.PageSize
        };
    }

    /// <summary>
    /// Applications → Export. Same search/status/type/customer/assignee/date
    /// filters and role-based visibility scope as GetPagedAsync, but ignores
    /// Page/PageSize and instead returns up to maxRows matching rows in one
    /// shot for a CSV download (LoansController.Export) — capped so a very
    /// broad filter (or none at all) can't pull an unbounded result set into
    /// memory.
    /// </summary>
    public async Task<List<LoanListDto>> GetForExportAsync(LoanFilterDto filter, int? currentUserId = null, string? currentUserRole = null, int maxRows = 5000)
    {
        var query = _set
            .Include(l => l.Customer)
            .Include(l => l.CreatedBy)
            .Include(l => l.AssignedTo)
            .AsQueryable();

        if (currentUserId.HasValue)
            query = ApplyVisibilityScope(_ctx, query, currentUserId.Value, currentUserRole);

        query = ApplyListFilters(_ctx, query, filter);

        return await query
            .Take(maxRows)
            .Select(l => new LoanListDto
            {
                Id              = l.Id,
                LoanNumber      = l.LoanNumber,
                LoanType        = l.LoanType.ToString(),
                Status          = l.Status.ToString(),
                RequestedAmount = l.RequestedAmount,
                ApprovedAmount  = l.ApprovedAmount,
                InterestRate    = l.InterestRate,
                TenureMonths    = l.TenureMonths,
                CustomerName    = l.Customer.FullName,
                CustomerPhone   = l.Customer.Phone,
                CreatedByName   = l.CreatedBy.FullName,
                AssignedToName  = l.AssignedTo != null ? l.AssignedTo.FullName : null,
                LoginUserName   = l.LoginUser  != null ? l.LoginUser.FullName  : null,
                RiskGrade       = _ctx.Set<BureauReport>()
                                    .Where(b => b.CustomerId == l.CustomerId)
                                    .OrderByDescending(b => b.ScoreGeneratedDate)
                                    .Select(b => b.RiskGrade)
                                    .FirstOrDefault(),
                CreatedAt       = l.CreatedAt
            })
            .ToListAsync();
    }

    /// <summary>
    /// Shared search/status/type/customer/assignee/date filtering + sort,
    /// factored out of GetPagedAsync so GetForExportAsync applies the exact
    /// same rules rather than a second, hand-copied version that could drift.
    /// </summary>
    private static IQueryable<Loan> ApplyListFilters(AppDbContext ctx, IQueryable<Loan> query, LoanFilterDto filter)
    {
        if (!string.IsNullOrEmpty(filter.Search))
        {
            var s = filter.Search.ToLower();
            query = query.Where(l =>
                l.LoanNumber.ToLower().Contains(s) ||
                l.Customer.FullName.ToLower().Contains(s) ||
                l.Customer.Phone.Contains(s) ||
                l.Customer.Email.ToLower().Contains(s));
        }

        if (filter.Status.HasValue)   query = query.Where(l => l.Status == filter.Status.Value);
        if (filter.LoanType.HasValue) query = query.Where(l => l.LoanType == filter.LoanType.Value);
        if (filter.CustomerId.HasValue) query = query.Where(l => l.CustomerId == filter.CustomerId.Value);
        if (filter.AssignedToUserId.HasValue) query = query.Where(l => l.AssignedToUserId == filter.AssignedToUserId.Value);
        if (filter.FromDate.HasValue) query = query.Where(l => l.CreatedAt >= filter.FromDate.Value);
        if (filter.ToDate.HasValue)   query = query.Where(l => l.CreatedAt <= filter.ToDate.Value.AddDays(1));

        return filter.SortBy.ToLower() switch
        {
            "amount"     => filter.SortDir == "asc" ? query.OrderBy(l => l.RequestedAmount)  : query.OrderByDescending(l => l.RequestedAmount),
            "status"     => filter.SortDir == "asc" ? query.OrderBy(l => l.Status)            : query.OrderByDescending(l => l.Status),
            "loannumber" => filter.SortDir == "asc" ? query.OrderBy(l => l.LoanNumber)        : query.OrderByDescending(l => l.LoanNumber),
            // Productivity audit (P1) — lets the Applications list be
            // triaged by bureau risk grade (A best .. D worst, alphabetical
            // sort happens to match risk order for this project's grades),
            // same stored BureauReport.RiskGrade value the list projection
            // above already surfaces, not a new computation.
            "riskgrade"  => filter.SortDir == "asc"
                ? query.OrderBy(l => ctx.Set<BureauReport>().Where(b => b.CustomerId == l.CustomerId).OrderByDescending(b => b.ScoreGeneratedDate).Select(b => b.RiskGrade).FirstOrDefault())
                : query.OrderByDescending(l => ctx.Set<BureauReport>().Where(b => b.CustomerId == l.CustomerId).OrderByDescending(b => b.ScoreGeneratedDate).Select(b => b.RiskGrade).FirstOrDefault()),
            _            => filter.SortDir == "asc" ? query.OrderBy(l => l.CreatedAt)         : query.OrderByDescending(l => l.CreatedAt)
        };
    }

    public async Task<string?> GetLatestRiskGradeAsync(int customerId)
    {
        return await _ctx.Set<BureauReport>()
            .Where(b => b.CustomerId == customerId)
            .OrderByDescending(b => b.ScoreGeneratedDate)
            .Select(b => b.RiskGrade)
            .FirstOrDefaultAsync();
    }

    public async Task<string> GenerateLoanNumberAsync()
    {
        // EFIN + current year + 7-digit random (non-sequential) number.
        // Year always reflects the current system year automatically.
        var year = DateTime.UtcNow.Year;
        string candidate;
        do
        {
            var suffix = System.Security.Cryptography.RandomNumberGenerator.GetInt32(1000000, 10000000).ToString();
            candidate = $"EFIN{year}{suffix}";
        }
        // Re-roll on collision to guarantee uniqueness across all statuses
        // (Draft, Processing, Completed, Rejected, Resumed all live in the same table).
        while (await _set.AnyAsync(l => l.LoanNumber == candidate));
        return candidate;
    }

    public async Task<DashboardStatsDto> GetDashboardStatsAsync(int? userId = null, string? role = null)
    {
        // Use SQL aggregation instead of loading all loans into memory.
        // Phase 2B — dashboard/recent-loans uses the same visibility scope as
        // the list and detail endpoints, so a Sales/Dsa/Partner/Manager user
        // never sees totals or "recent loans" that include loans outside their scope.
        var baseQuery = _set.AsQueryable();
        if (userId.HasValue)
            baseQuery = ApplyVisibilityScope(_ctx, baseQuery, userId.Value, role);

        // Single aggregation query — no ToListAsync() on full table
        var stats = await baseQuery.GroupBy(_ => 1).Select(g => new
        {
            Total        = g.Count(),
            Pending      = g.Count(l => l.Status == LoanStatus.Submitted || l.Status == LoanStatus.UnderReview),
            Approved     = g.Count(l => l.Status == LoanStatus.Approved),
            Rejected     = g.Count(l => l.Status == LoanStatus.Rejected),
            Disbursed    = g.Count(l => l.Status == LoanStatus.Disbursed),
            TotalReq     = g.Sum(l => l.RequestedAmount),
            TotalAppr    = g.Where(l => l.ApprovedAmount != null).Sum(l => l.ApprovedAmount ?? 0),
            TotalDisb    = g.Where(l => l.Status == LoanStatus.Disbursed && l.ApprovedAmount != null)
                            .Sum(l => l.ApprovedAmount ?? 0),
        }).FirstOrDefaultAsync();

        var customers = await _ctx.Set<Customer>().CountAsync(c => !c.IsDeleted);

        var recent = await baseQuery
            .Include(l => l.Customer).Include(l => l.CreatedBy).Include(l => l.AssignedTo).Include(l => l.LoginUser)
            .OrderByDescending(l => l.CreatedAt).Take(10)
            .Select(l => new LoanListDto
            {
                Id              = l.Id,
                LoanNumber      = l.LoanNumber,
                LoanType        = l.LoanType.ToString(),
                Status          = l.Status.ToString(),
                RequestedAmount = l.RequestedAmount,
                ApprovedAmount  = l.ApprovedAmount,
                InterestRate    = l.InterestRate,
                TenureMonths    = l.TenureMonths,
                CustomerName    = l.Customer.FullName,
                CustomerPhone   = l.Customer.Phone,
                CreatedByName   = l.CreatedBy.FullName,
                AssignedToName  = l.AssignedTo != null ? l.AssignedTo.FullName : null,
                LoginUserName   = l.LoginUser  != null ? l.LoginUser.FullName  : null,
                RiskGrade       = _ctx.Set<BureauReport>()
                                    .Where(b => b.CustomerId == l.CustomerId)
                                    .OrderByDescending(b => b.ScoreGeneratedDate)
                                    .Select(b => b.RiskGrade)
                                    .FirstOrDefault(),
                CreatedAt       = l.CreatedAt
            }).ToListAsync();

        return new DashboardStatsDto
        {
            TotalLoans           = stats?.Total ?? 0,
            TotalCustomers       = customers,
            PendingLoans         = stats?.Pending ?? 0,
            ApprovedLoans        = stats?.Approved ?? 0,
            RejectedLoans        = stats?.Rejected ?? 0,
            DisbursedLoans       = stats?.Disbursed ?? 0,
            TotalRequestedAmount = stats?.TotalReq ?? 0,
            TotalApprovedAmount  = stats?.TotalAppr ?? 0,
            TotalDisbursedAmount = stats?.TotalDisb ?? 0,
            RecentLoans          = recent
        };
    }

    public async Task<IEnumerable<Loan>> GetLoansByCustomerAsync(int customerId) =>
        await _set.Where(l => l.CustomerId == customerId).ToListAsync();
}
