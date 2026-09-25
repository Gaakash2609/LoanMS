using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

public interface ICustomerService
{
    // Phase 4 (Customer Visibility): currentUserId is required now (not
    // defaulted) on every caller-facing read surface, mirroring
    // ILoanService — so GetById/GetAll/Search/GetPaged all enforce the same
    // role-based visibility scope used for Loans. callerRole is reused for
    // both this scoping AND the existing PAN/Aadhaar masking decision.
    Task<ApiResponseDto<CustomerDto>> GetByIdAsync(int id, int currentUserId, string callerRole = "Sales");
    Task<ApiResponseDto<PagedResultDto<CustomerDto>>> GetAllAsync(int page, int pageSize, string? search, int currentUserId, string callerRole);
    Task<ApiResponseDto<CustomerDto>> CreateAsync(CreateCustomerRequestDto request);
    Task<ApiResponseDto<CustomerDto>> UpdateAsync(int id, UpdateCustomerRequestDto request);
    Task<bool> PanExistsAsync(string pan, int? excludeId = null);
    Task<PagedResultDto<CustomerDto>> GetPagedAsync(int page, int pageSize, string? search, int currentUserId, string callerRole);
    /// <summary>Global (not user-scoped) customer identification on normalised
    /// PAN / mobile / email. ownCustomerId/ownLoanId = the draft being
    /// saved/submitted, whose own provisional customer is not a competing match.
    /// lockIdentifiers: take the per-identifier locks first (call inside the
    /// transaction that will create/link the customer).</summary>
    Task<CustomerIdentityMatchDto> ResolveIdentityAsync(string? pan, string? mobile, string? email,
        int? ownCustomerId = null, int? ownLoanId = null, bool lockIdentifiers = false);
}
