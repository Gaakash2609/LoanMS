using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Repositories;

// ── Generic Repository ────────────────────────────────────────────────────────
public class GenericRepository<T> : IGenericRepository<T> where T : BaseEntity
{
    protected readonly AppDbContext _ctx;
    protected readonly DbSet<T> _set;

    public GenericRepository(AppDbContext ctx)
    {
        _ctx = ctx;
        _set = ctx.Set<T>();
    }

    public async Task<T?> GetByIdAsync(int id) =>
        await _set.FirstOrDefaultAsync(e => e.Id == id);

    public async Task<IEnumerable<T>> GetAllAsync() =>
        await _set.ToListAsync();

    public async Task<T> AddAsync(T entity)
    {
        await _set.AddAsync(entity);
        return entity;
    }

    public async Task<T> UpdateAsync(T entity)
    {
        _set.Update(entity);
        return await Task.FromResult(entity);
    }

    public async Task DeleteAsync(int id)
    {
        var entity = await _set.FindAsync(id);
        if (entity != null) { entity.IsDeleted = true; entity.UpdatedAt = DateTime.UtcNow; }
    }

    public async Task<bool> ExistsAsync(int id) =>
        await _set.AnyAsync(e => e.Id == id);
}

// ── User Repository ───────────────────────────────────────────────────────────
public class UserRepository : GenericRepository<User>, IUserRepository
{
    public UserRepository(AppDbContext ctx) : base(ctx) { }

    public async Task<User?> GetByEmailAsync(string email) =>
        await _set.FirstOrDefaultAsync(u => u.Email.ToLower() == email.ToLower());

    public async Task<User?> GetByRefreshTokenAsync(string refreshToken) =>
        await _set.FirstOrDefaultAsync(u => u.RefreshToken == refreshToken);

    public async Task<IEnumerable<User>> GetAllActiveUsersAsync() =>
        await _set.Where(u => u.IsActive).OrderBy(u => u.FullName).ToListAsync();

    public async Task<bool> EmailExistsAsync(string email, int? excludeId = null)
    {
        var query = _set.Where(u => u.Email == email.ToLower());
        if (excludeId.HasValue) query = query.Where(u => u.Id != excludeId.Value);
        return await query.AnyAsync();
    }
}

// ── Customer Repository ───────────────────────────────────────────────────────
public class CustomerRepository : GenericRepository<Customer>, ICustomerRepository
{
    public CustomerRepository(AppDbContext ctx) : base(ctx) { }

    public async Task<Customer?> GetWithLoansAsync(int id) =>
        await _set.Include(c => c.Loans).FirstOrDefaultAsync(c => c.Id == id);

    public async Task<PagedResultDto<CustomerDto>> GetPagedAsync(int page, int pageSize, string? search)
    {
        var query = _set.AsQueryable();

        if (!string.IsNullOrEmpty(search))
        {
            var s = search.ToLower();
            query = query.Where(c =>
                c.FullName.ToLower().Contains(s) ||
                c.Email.ToLower().Contains(s) ||
                c.Phone.Contains(s) ||
                (c.PanNumber != null && c.PanNumber.ToLower().Contains(s)));
        }

        var total = await query.CountAsync();
        var items = await query
            .OrderByDescending(c => c.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(c => new CustomerDto
            {
                Id             = c.Id,
                FullName       = c.FullName,
                Email          = c.Email,
                Phone          = c.Phone,
                PanNumber      = c.PanNumber,
                AadhaarNumber  = c.AadhaarNumber,
                DateOfBirth    = c.DateOfBirth,
                Address        = c.Address,
                City           = c.City,
                State          = c.State,
                PinCode        = c.PinCode,
                MonthlyIncome  = c.MonthlyIncome,
                EmploymentType = c.EmploymentType,
                CompanyName    = c.CompanyName,
                CibilScore     = c.CibilScore,
                TotalLoans     = c.Loans.Count,
                CreatedAt      = c.CreatedAt
            })
            .ToListAsync();

        return new PagedResultDto<CustomerDto>
        {
            Items = items, TotalCount = total, Page = page, PageSize = pageSize
        };
    }

    public async Task<bool> EmailExistsAsync(string email, int? excludeId = null)
    {
        var query = _set.Where(c => c.Email == email.ToLower());
        if (excludeId.HasValue) query = query.Where(c => c.Id != excludeId.Value);
        return await query.AnyAsync();
    }

    public async Task<bool> PanExistsAsync(string pan, int? excludeId = null)
    {
        var query = _set.Where(c => c.PanNumber == pan.ToUpper());
        if (excludeId.HasValue) query = query.Where(c => c.Id != excludeId.Value);
        return await query.AnyAsync();
    }
}

// ── Loan Repository ───────────────────────────────────────────────────────────
public class LoanRepository : GenericRepository<Loan>, ILoanRepository
{
    public LoanRepository(AppDbContext ctx) : base(ctx) { }

    public async Task<Loan?> GetWithDetailsAsync(int id) =>
        await _set
            .Include(l => l.Customer)
            .Include(l => l.CreatedBy)
            .Include(l => l.AssignedTo)
            .Include(l => l.StatusHistory.OrderByDescending(h => h.CreatedAt))
                .ThenInclude(h => h.ChangedBy)
            .Include(l => l.Documents)
            .FirstOrDefaultAsync(l => l.Id == id);

    public async Task<PagedResultDto<LoanListDto>> GetPagedAsync(LoanFilterDto filter, int? currentUserId = null, string? currentUserRole = null)
    {
        var query = _set
            .Include(l => l.Customer)
            .Include(l => l.CreatedBy)
            .Include(l => l.AssignedTo)
            .AsQueryable();

        // Role-based scoping — enforced on the server, not the client
        // Sales: own created/assigned loans only
        if (currentUserRole == "Sales" && currentUserId.HasValue)
            query = query.Where(l => l.CreatedByUserId == currentUserId || l.AssignedToUserId == currentUserId);
        // Partner / DSA: own submitted applications only
        else if ((currentUserRole == "partner" || currentUserRole == "dsa_user") && currentUserId.HasValue)
            query = query.Where(l => l.CreatedByUserId == currentUserId);

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
        // Use SQL aggregation instead of loading all loans into memory
        var baseQuery = _set.AsQueryable();
        if (role == "Sales" && userId.HasValue)
            baseQuery = baseQuery.Where(l => l.CreatedByUserId == userId || l.AssignedToUserId == userId);
        else if ((role == "partner" || role == "dsa_user") && userId.HasValue)
            baseQuery = baseQuery.Where(l => l.CreatedByUserId == userId);

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

// ── LoanStatusHistory Repository ──────────────────────────────────────────────
public class LoanStatusHistoryRepository : GenericRepository<LoanStatusHistory>, ILoanStatusHistoryRepository
{
    public LoanStatusHistoryRepository(AppDbContext ctx) : base(ctx) { }

    public async Task<IEnumerable<LoanStatusHistory>> GetByLoanIdAsync(int loanId) =>
        await _set.Include(h => h.ChangedBy)
                  .Where(h => h.LoanId == loanId)
                  .OrderByDescending(h => h.CreatedAt)
                  .ToListAsync();
}

// ── Unit of Work ──────────────────────────────────────────────────────────────
public class UnitOfWork : IUnitOfWork
{
    private readonly AppDbContext _ctx;

    public IUserRepository               Users               { get; }
    public ICustomerRepository           Customers           { get; }
    public ILoanRepository               Loans               { get; }
    public ILoanStatusHistoryRepository  LoanStatusHistories { get; }
    public IPasswordResetTokenRepository PasswordResetTokens { get; }

    public UnitOfWork(AppDbContext ctx)
    {
        _ctx                = ctx;
        Users               = new UserRepository(ctx);
        Customers           = new CustomerRepository(ctx);
        Loans               = new LoanRepository(ctx);
        LoanStatusHistories = new LoanStatusHistoryRepository(ctx);
        PasswordResetTokens = new PasswordResetTokenRepository(ctx);
    }

    public async Task<int> SaveChangesAsync() => await _ctx.SaveChangesAsync();

    public void Dispose() => _ctx.Dispose();
}

// ── Password Reset Token Repository ──────────────────────────────────────────
public class PasswordResetTokenRepository
    : GenericRepository<PasswordResetToken>, IPasswordResetTokenRepository
{
    public PasswordResetTokenRepository(AppDbContext ctx) : base(ctx) { }

    public async Task<PasswordResetToken?> GetValidTokenAsync(string tokenHash) =>
        await _set.Include(t => t.User)
                  .FirstOrDefaultAsync(t =>
                      t.TokenHash == tokenHash &&
                      !t.IsUsed   &&
                      t.ExpiresAt > DateTime.UtcNow);

    public async Task InvalidateAllForUserAsync(int userId)
    {
        var tokens = await _set
            .Where(t => t.UserId == userId && !t.IsUsed)
            .ToListAsync();

        foreach (var token in tokens)
        {
            token.IsUsed    = true;
            token.UpdatedAt = DateTime.UtcNow;
        }
        // Caller (UnitOfWork.SaveChangesAsync) persists changes.
    }
}
