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
