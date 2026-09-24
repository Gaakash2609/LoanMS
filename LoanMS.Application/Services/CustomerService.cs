using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Services;

public class CustomerService : ICustomerService
{
    private readonly IUnitOfWork   _uow;

    public CustomerService(IUnitOfWork uow)
    {
        _uow   = uow;
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
        // Including soft-deleted rows: the unique indexes on Email/PanNumber
        // still hold a deleted customer's values, so a filtered check passed
        // and the INSERT then failed with an unhandled duplicate-key 500.
        if (await _uow.Customers.EmailTakenIncludingDeletedAsync(request.Email))
            return ApiResponseDto<CustomerDto>.Fail("Email already registered.");

        if (!string.IsNullOrEmpty(request.PanNumber) && await _uow.Customers.PanTakenIncludingDeletedAsync(request.PanNumber))
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
            Gender         = NormalizeGender(request.Gender),
            FatherName     = request.FatherName?.Trim(),
            ResidenceType  = request.ResidenceType,
            MotherName             = request.MotherName?.Trim(),
            AlternatePhone         = request.AlternatePhone?.Trim(),
            HouseNo                = request.HouseNo?.Trim(),
            PermanentHouseNo       = request.PermanentHouseNo?.Trim(),
            PermanentAddress       = request.PermanentAddress?.Trim(),
            PermanentCity          = request.PermanentCity?.Trim(),
            PermanentState         = request.PermanentState?.Trim(),
            PermanentPinCode       = request.PermanentPinCode?.Trim(),
            PermanentResidenceType = request.PermanentResidenceType,
            Designation            = request.Designation?.Trim(),
            CompanyType            = request.CompanyType?.Trim(),
            OfficialEmail          = request.OfficialEmail?.Trim(),
            OfficeAddress          = request.OfficeAddress?.Trim(),
            OfficePinCode          = request.OfficePinCode?.Trim()
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

        // Same unique-index rule as CreateAsync (deleted rows count), and PAN
        // was not checked on update at all — both used to surface as a 500.
        if (await _uow.Customers.EmailTakenIncludingDeletedAsync(request.Email, id))
            return ApiResponseDto<CustomerDto>.Fail("Email already in use.");

        if (!string.IsNullOrEmpty(request.PanNumber) && await _uow.Customers.PanTakenIncludingDeletedAsync(request.PanNumber, id))
            return ApiResponseDto<CustomerDto>.Fail("PAN number already registered to another customer.");

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
        customer.Gender = NormalizeGender(request.Gender);
        customer.FatherName     = request.FatherName?.Trim();
        customer.ResidenceType  = request.ResidenceType;
        customer.MotherName             = request.MotherName?.Trim();
        customer.AlternatePhone         = request.AlternatePhone?.Trim();
        customer.HouseNo                = request.HouseNo?.Trim();
        customer.PermanentHouseNo       = request.PermanentHouseNo?.Trim();
        customer.PermanentAddress       = request.PermanentAddress?.Trim();
        customer.PermanentCity          = request.PermanentCity?.Trim();
        customer.PermanentState         = request.PermanentState?.Trim();
        customer.PermanentPinCode       = request.PermanentPinCode?.Trim();
        customer.PermanentResidenceType = request.PermanentResidenceType;
        customer.Designation            = request.Designation?.Trim();
        customer.CompanyType            = request.CompanyType?.Trim();
        customer.OfficialEmail          = request.OfficialEmail?.Trim();
        customer.OfficeAddress          = request.OfficeAddress?.Trim();
        customer.OfficePinCode          = request.OfficePinCode?.Trim();
        customer.UpdatedAt      = DateTime.UtcNow;

        await _uow.Customers.UpdateAsync(customer);
        await _uow.SaveChangesAsync();
        return ApiResponseDto<CustomerDto>.Ok(MapToDto(customer), "Customer updated.");
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
            MotherName             = c.MotherName,
            AlternatePhone         = c.AlternatePhone,
            HouseNo                = c.HouseNo,
            PermanentHouseNo       = c.PermanentHouseNo,
            PermanentAddress       = c.PermanentAddress,
            PermanentCity          = c.PermanentCity,
            PermanentState         = c.PermanentState,
            PermanentPinCode       = c.PermanentPinCode,
            PermanentResidenceType = c.PermanentResidenceType,
            Designation            = c.Designation,
            CompanyType            = c.CompanyType,
            OfficialEmail          = c.OfficialEmail,
            OfficeAddress          = c.OfficeAddress,
            OfficePinCode          = c.OfficePinCode,
            TotalLoans     = c.Loans?.Count ?? 0,
            CreatedAt      = c.CreatedAt
        };
    }

    public async Task<bool> PanExistsAsync(string pan, int? excludeId = null)
        => await _uow.Customers.PanExistsAsync(pan.ToUpper().Trim(), excludeId);

    public async Task<PagedResultDto<CustomerDto>> GetPagedAsync(int page, int pageSize, string? search, int currentUserId, string callerRole)
        => await _uow.Customers.GetPagedAsync(page, pageSize, search, currentUserId, callerRole);

    // Boundary check, not the primary fix (that is the gender <select> in
    // NewApplicationPage.tsx, which now sends 'M'/'F'/'O' -- exactly what
    // legacy's own <option value="M">/"F"/"O"> sends, app.css/efin-app.js:
    // 26108-26110). Customers.Gender is varchar(1) by design
    // (20260726010000_AddCustomerKycFields.cs); this exists so any caller
    // still sending the full word -- a cached pre-fix frontend bundle, a
    // future direct API call -- can never again reproduce the 500 that hit
    // production 225 times on 2026-08-24 ("value too long for type
    // character varying(1)"). Mirrors WizardController.NormalizeGender,
    // which is the same fix for the same column via a different endpoint.
    private static string? NormalizeGender(string? raw)
    {
        var g = raw?.Trim();
        if (string.IsNullOrEmpty(g)) return g;
        return g[0] is 'M' or 'm' ? "M" : g[0] is 'F' or 'f' ? "F" : "O";
    }
}
