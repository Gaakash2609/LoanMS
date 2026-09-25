using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Repositories;

// ── Customer Repository ───────────────────────────────────────────────────────
public class CustomerRepository : GenericRepository<Customer>, ICustomerRepository
{
    public CustomerRepository(AppDbContext ctx) : base(ctx) { }

    public async Task<Customer?> GetWithLoansAsync(int id, int? currentUserId = null, string? currentUserRole = null)
    {
        var query = _set.Include(c => c.Loans).AsQueryable();
        if (currentUserId.HasValue)
            query = ApplyCustomerVisibilityScope(query, currentUserId.Value, currentUserRole);
        return await query.FirstOrDefaultAsync(c => c.Id == id);
    }

    /// <summary>
    /// Phase 4 — role-based Customer visibility. Reuses
    /// LoanRepository.ApplyVisibilityScope (the same rule set that gates
    /// Loan reads) instead of a second, separate authorization system.
    ///   Admin -> all customers (including customers with zero loans).
    ///   Everyone else -> a customer is visible only if at least one of their
    ///     loans falls inside the caller's loan visibility scope (EXISTS check
    ///     via Customer.Loans). A customer with loans split across scopes
    ///     (e.g. one assigned to this user, one not) is still visible as a
    ///     whole record, not partially.
    /// </summary>
    private IQueryable<Customer> ApplyCustomerVisibilityScope(IQueryable<Customer> query, int currentUserId, string? currentUserRole)
    {
        if (string.Equals(currentUserRole, "Admin", StringComparison.OrdinalIgnoreCase))
            return query;

        var scopedLoans = LoanRepository.ApplyVisibilityScope(_ctx, _ctx.Set<Loan>().AsQueryable(), currentUserId, currentUserRole);
        return query.Where(c => scopedLoans.Any(l => l.CustomerId == c.Id));
    }

    public async Task<PagedResultDto<CustomerDto>> GetPagedAsync(int page, int pageSize, string? search, int? currentUserId = null, string? currentUserRole = null)
    {
        var query = _set.AsQueryable();
        if (currentUserId.HasValue)
            query = ApplyCustomerVisibilityScope(query, currentUserId.Value, currentUserRole);

        if (!string.IsNullOrEmpty(search))
        {
            var s = search.ToLower();
            // A mobile typed as "+91 98765-43210" should find "9876543210":
            // also match the digits against the normalised phone key.
            var digits = new string(search.Where(char.IsAsciiDigit).ToArray());
            var hasDigits = digits.Length >= 3;
            query = query.Where(c =>
                c.FullName.ToLower().Contains(s) ||
                c.Email.ToLower().Contains(s) ||
                c.Phone.Contains(s) ||
                (hasDigits && c.PhoneNormalized != null && c.PhoneNormalized.Contains(digits)) ||
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

    public async Task<bool> EmailTakenIncludingDeletedAsync(string email, int? excludeId = null)
    {
        var normalized = email.ToLower().Trim();
        return await _set.IgnoreQueryFilters()
            .AnyAsync(c => c.Email == normalized && (!excludeId.HasValue || c.Id != excludeId.Value));
    }

    public async Task<bool> PanTakenIncludingDeletedAsync(string pan, int? excludeId = null)
    {
        var normalized = pan.ToUpper().Trim();
        // Normalised key too, so a legacy "abcde1234f " row still counts as taken.
        var key = Customer.NormalizePan(pan);
        return await _set.IgnoreQueryFilters()
            .AnyAsync(c => (c.PanNumber == normalized || (key != null && c.PanNormalized == key))
                           && (!excludeId.HasValue || c.Id != excludeId.Value));
    }

    public async Task<List<CustomerIdentityRow>> FindByIdentityKeysAsync(string? pan, string? mobile, string? email)
    {
        if (pan == null && mobile == null && email == null) return new List<CustomerIdentityRow>();
        return await _set.IgnoreQueryFilters().AsNoTracking()
            .Where(c => (pan != null && c.PanNormalized == pan)
                     || (mobile != null && c.PhoneNormalized == mobile)
                     || (email != null && c.EmailNormalized == email))
            .Select(c => new CustomerIdentityRow
            {
                Id = c.Id, IsDeleted = c.IsDeleted,
                PanNormalized = c.PanNormalized, PhoneNormalized = c.PhoneNormalized, EmailNormalized = c.EmailNormalized,
            })
            .ToListAsync();
    }

    public async Task<CustomerIdentityRow?> GetIdentityRowAsync(int customerId) =>
        await _set.IgnoreQueryFilters().AsNoTracking()
            .Where(c => c.Id == customerId)
            .Select(c => new CustomerIdentityRow
            {
                Id = c.Id, IsDeleted = c.IsDeleted,
                PanNormalized = c.PanNormalized, PhoneNormalized = c.PhoneNormalized, EmailNormalized = c.EmailNormalized,
            })
            .FirstOrDefaultAsync();

    public async Task<bool> IsProvisionalForLoanAsync(int customerId, int loanId) =>
        !await _ctx.Set<Loan>().IgnoreQueryFilters().AnyAsync(l => l.CustomerId == customerId && l.Id != loanId)
        && !await _ctx.Set<BureauReport>().IgnoreQueryFilters().AnyAsync(b => b.CustomerId == customerId);

    private const int IdentityLockClass = 7102;

    public async Task LockIdentityKeysAsync(string? pan, string? mobile, string? email)
    {
        if (!_ctx.Database.IsNpgsql() || _ctx.Database.CurrentTransaction == null) return;
        // Fixed (ordinal) order, so two sessions locking overlapping key sets
        // can never deadlock on each other.
        var keys = new[] { pan is null ? null : "P:" + pan, mobile is null ? null : "M:" + mobile, email is null ? null : "E:" + email }
            .Where(k => k != null).Select(k => k!).OrderBy(k => k, StringComparer.Ordinal);
        foreach (var key in keys)
            await _ctx.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT pg_advisory_xact_lock({IdentityLockClass}, hashtext({key}))");
    }
}
