using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Services;

public class CustomerService : ICustomerService
{
    private readonly IUnitOfWork   _uow;
    private readonly ICacheService _cache;

    public CustomerService(IUnitOfWork uow, ICacheService cache)
    {
        _uow   = uow;
        _cache = cache;
    }

    public async Task<ApiResponseDto<CustomerDto>> GetByIdAsync(int id, int currentUserId, string callerRole = "Sales")
    {
        // Phase 4 — role-based visibility is enforced at the repository query
        // level (via Customer.Loans, reusing Loan's ApplyVisibilityScope), not
        // after the fact. A customer outside the caller's scope comes back
        // null the same way a genuinely missing customer would.
        var c = await _uow.Customers.GetWithLoansAsync(id, currentUserId, callerRole);
        if (c == null) return ApiResponseDto<CustomerDto>.Fail("Customer not found.");
        return ApiResponseDto<CustomerDto>.Ok(MapToDto(c, callerRole));
    }

    public async Task<ApiResponseDto<PagedResultDto<CustomerDto>>> GetAllAsync(int page, int pageSize, string? search, int currentUserId, string callerRole)
    {
        // Same fix as LoanService.GetAllAsync/GetDashboardStatsAsync (Phase 1/3):
        // this used to cache the no-search page for 30s under a
        // "customers:list:{page}:{pageSize}" key and rely on
        // ICacheService.RemoveByPrefixAsync("customers:list:") on Create to
        // invalidate it. RemoveByPrefixAsync is a no-op on the Redis-backed
        // DistributedCacheService (see CacheService.cs), and even with the
        // correctly-implemented MemoryCacheService fallback, ECS runs multiple
        // Fargate task replicas each with their own independent IMemoryCache —
        // invalidating on the replica that handled Device A's create does
        // nothing for the replica that serves Device B's customer-list
        // request. That let a newly created (or updated — Update never
        // invalidated this cache at all) customer stay invisible/stale on
        // other devices/replicas for up to 30s, exactly like the loan-list
        // bug this mirrors. Reading straight through removes the staleness
        // window entirely.
        var result = await _uow.Customers.GetPagedAsync(page, pageSize, search, currentUserId, callerRole);
        return ApiResponseDto<PagedResultDto<CustomerDto>>.Ok(result);
    }

    public async Task<ApiResponseDto<CustomerDto>> CreateAsync(CreateCustomerRequestDto request)
    {
        if (await _uow.Customers.EmailExistsAsync(request.Email))
            return ApiResponseDto<CustomerDto>.Fail("Email already registered.");

        if (!string.IsNullOrEmpty(request.PanNumber) && await _uow.Customers.PanExistsAsync(request.PanNumber))
            return ApiResponseDto<CustomerDto>.Fail("PAN number already registered.");

        var customer = new Customer
        {
            FullName       = request.FullName.Trim(),
            Email          = request.Email.ToLower().Trim(),
            Phone          = request.Phone.Trim(),
            PanNumber      = request.PanNumber?.ToUpper().Trim(),
            AadhaarNumber  = request.AadhaarNumber?.Trim(),
            DateOfBirth    = request.DateOfBirth,
            Address        = request.Address,
            City           = request.City,
            State          = request.State,
            PinCode        = request.PinCode,
            MonthlyIncome  = request.MonthlyIncome,
            MonthlyObligations = request.MonthlyObligations,
            EmploymentType = request.EmploymentType,
            CompanyName    = request.CompanyName,
            CibilScore     = request.CibilScore,
            Gender         = request.Gender?.Trim(),
            FatherName     = request.FatherName?.Trim(),
            ResidenceType  = request.ResidenceType
        };

        await _uow.Customers.AddAsync(customer);
        await _uow.SaveChangesAsync();
        // No list cache to invalidate — GetAllAsync reads straight through now.
        return ApiResponseDto<CustomerDto>.Ok(MapToDto(customer), "Customer created.");
    }

    public async Task<ApiResponseDto<CustomerDto>> UpdateAsync(int id, UpdateCustomerRequestDto request)
    {
        var customer = await _uow.Customers.GetByIdAsync(id);
        if (customer == null) return ApiResponseDto<CustomerDto>.Fail("Customer not found.");

        if (await _uow.Customers.EmailExistsAsync(request.Email, id))
            return ApiResponseDto<CustomerDto>.Fail("Email already in use.");

        customer.FullName       = request.FullName.Trim();
        customer.Email          = request.Email.ToLower().Trim();
        customer.Phone          = request.Phone.Trim();
        customer.PanNumber      = request.PanNumber?.ToUpper().Trim();
        customer.AadhaarNumber  = request.AadhaarNumber?.Trim();
        customer.DateOfBirth    = request.DateOfBirth;
        customer.Address        = request.Address;
        customer.City           = request.City;
        customer.State          = request.State;
        customer.PinCode        = request.PinCode;
        customer.MonthlyIncome  = request.MonthlyIncome;
        customer.MonthlyObligations = request.MonthlyObligations;
        customer.EmploymentType = request.EmploymentType;
        customer.CompanyName    = request.CompanyName;
        customer.CibilScore     = request.CibilScore;
        customer.Gender         = request.Gender?.Trim();
        customer.FatherName     = request.FatherName?.Trim();
        customer.ResidenceType  = request.ResidenceType;
        customer.UpdatedAt      = DateTime.UtcNow;

        await _uow.Customers.UpdateAsync(customer);
        await _uow.SaveChangesAsync();
        return ApiResponseDto<CustomerDto>.Ok(MapToDto(customer), "Customer updated.");
    }

    public async Task<ApiResponseDto<bool>> DeleteAsync(int id)
    {
        var customer = await _uow.Customers.GetByIdAsync(id);
        if (customer == null) return ApiResponseDto<bool>.Fail("Customer not found.");

        var loans = await _uow.Loans.GetLoansByCustomerAsync(id);
        if (loans.Any(l => l.Status != LoanMS.Domain.Enums.LoanStatus.Closed &&
                           l.Status != LoanMS.Domain.Enums.LoanStatus.Rejected))
            return ApiResponseDto<bool>.Fail("Cannot delete customer with active loans.");

        await _uow.Customers.DeleteAsync(id);
        await _uow.SaveChangesAsync();
        return ApiResponseDto<bool>.Ok(true, "Customer deleted.");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Roles that may see unmasked PAN and Aadhaar.
    /// All other roles receive masked values.
    /// </summary>
    private static readonly HashSet<string> _sensitiveRoles =
        new(StringComparer.OrdinalIgnoreCase) { "Admin", "Manager" };

    /// <summary>Mask PAN: show first 5 chars + XXXXX.</summary>
    internal static string? MaskPan(string? pan) =>
        string.IsNullOrEmpty(pan) ? pan
        : pan.Length >= 5 ? pan[..5] + "XXXXX"
        : new string('X', pan.Length);

    /// <summary>Mask Aadhaar: show last 4 digits only.</summary>
    internal static string? MaskAadhaar(string? aadhaar) =>
        string.IsNullOrEmpty(aadhaar) ? aadhaar
        : aadhaar.Length >= 4 ? "XXXX-XXXX-" + aadhaar[^4..]
        : new string('X', aadhaar.Length);

    internal static CustomerDto MapToDto(Customer c, string callerRole = "Sales")
    {
        var elevated = _sensitiveRoles.Contains(callerRole);
        return new CustomerDto
        {
            Id             = c.Id,
            FullName       = c.FullName,
            Email          = c.Email,
            Phone          = c.Phone,
            PanNumber      = elevated ? c.PanNumber      : MaskPan(c.PanNumber),
            AadhaarNumber  = elevated ? c.AadhaarNumber  : MaskAadhaar(c.AadhaarNumber),
            DateOfBirth    = c.DateOfBirth,
            Address        = c.Address,
            City           = c.City,
            State          = c.State,
            PinCode        = c.PinCode,
            MonthlyIncome  = c.MonthlyIncome,
            MonthlyObligations = c.MonthlyObligations,
            EmploymentType = c.EmploymentType,
            CompanyName    = c.CompanyName,
            CibilScore     = c.CibilScore,
            Gender         = c.Gender,
            FatherName     = c.FatherName,
            ResidenceType  = c.ResidenceType,
            TotalLoans     = c.Loans?.Count ?? 0,
            CreatedAt      = c.CreatedAt
        };
    }

    public async Task<bool> PanExistsAsync(string pan, int? excludeId = null)
        => await _uow.Customers.PanExistsAsync(pan.ToUpper().Trim(), excludeId);

    public async Task<PagedResultDto<CustomerDto>> GetPagedAsync(int page, int pageSize, string? search, int currentUserId, string callerRole)
        => await _uow.Customers.GetPagedAsync(page, pageSize, search, currentUserId, callerRole);
}
