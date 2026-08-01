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
            query = ApplyVisibilityScope(query, currentUserId.Value, currentUserRole);

        return await query.FirstOrDefaultAsync(l => l.Id == id);
    }

    /// <summary>
    /// Phase 2B — single source of truth for role-based Loan visibility.
    /// Applied to every loan read surface: list, search/filter, dashboard/recent
    /// loans, and detail-by-id. This is server-side query scoping — the frontend
    /// never decides who can see what.
    ///   Sales   -> own created loans + loans currently assigned to them
    ///   Dsa     -> loans whose DsaId matches the DsaPartner record linked to this user
    ///   Partner -> loans whose PartnerId matches the DsaPartner record linked to this user
    ///   Manager -> loans at a Location the manager is the Team lead for (reuses
    ///              the existing Team/Location relationship — no new model)
    ///   Admin   -> unrestricted
    ///   anything else / unrecognized role -> no loans visible
    /// </summary>
    private IQueryable<Loan> ApplyVisibilityScope(IQueryable<Loan> query, int currentUserId, string? currentUserRole)
    {
        var role = currentUserRole ?? string.Empty;

        if (string.Equals(role, "Admin", StringComparison.OrdinalIgnoreCase))
            return query;

        if (string.Equals(role, "Sales", StringComparison.OrdinalIgnoreCase))
            return query.Where(l => l.CreatedByUserId == currentUserId || l.AssignedToUserId == currentUserId);

        if (string.Equals(role, "Dsa", StringComparison.OrdinalIgnoreCase))
            // Never compare currentUserId directly to Loan.DsaId — DsaId is a
            // DsaPartner record id, not a User id. Resolve via the linked user.
            return query.Where(l => l.DsaId != null && l.Dsa != null && l.Dsa.LinkedUserId == currentUserId);

        if (string.Equals(role, "Partner", StringComparison.OrdinalIgnoreCase))
            // Same rule for Partner: never compare currentUserId directly to Loan.PartnerId.
            return query.Where(l => l.PartnerId != null && l.Partner != null && l.Partner.LinkedUserId == currentUserId);

        if (string.Equals(role, "Manager", StringComparison.OrdinalIgnoreCase))
        {
            var authorizedLocationIds = _ctx.Set<Team>()
                .Where(t => t.TeamLeadUserId == currentUserId && t.LocationId != null)
                .Select(t => t.LocationId!.Value);
            return query.Where(l => l.LocationId != null && authorizedLocationIds.Contains(l.LocationId!.Value));
        }

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
        var query = ApplyVisibilityScope(_set.AsQueryable(), currentUserId, currentUserRole);
        return await query.AnyAsync(l => l.Id == loanId);
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
            query = ApplyVisibilityScope(query, currentUserId.Value, currentUserRole);

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

        query = filter.SortBy.ToLower() switch
        {
            "amount"     => filter.SortDir == "asc" ? query.OrderBy(l => l.RequestedAmount)  : query.OrderByDescending(l => l.RequestedAmount),
            "status"     => filter.SortDir == "asc" ? query.OrderBy(l => l.Status)            : query.OrderByDescending(l => l.Status),
            "loannumber" => filter.SortDir == "asc" ? query.OrderBy(l => l.LoanNumber)        : query.OrderByDescending(l => l.LoanNumber),
            _            => filter.SortDir == "asc" ? query.OrderBy(l => l.CreatedAt)         : query.OrderByDescending(l => l.CreatedAt)
        };

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
                CreatedAt       = l.CreatedAt
            })
            .ToListAsync();

        return new PagedResultDto<LoanListDto>
        {
            Items = items, TotalCount = total, Page = filter.Page, PageSize = filter.PageSize
        };
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
            baseQuery = ApplyVisibilityScope(baseQuery, userId.Value, role);

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
            .Include(l => l.Customer).Include(l => l.CreatedBy).Include(l => l.AssignedTo)
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
