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
    Task<ApiResponseDto<bool>> DeleteAsync(int id);
    Task<bool> PanExistsAsync(string pan, int? excludeId = null);
    Task<PagedResultDto<CustomerDto>> GetPagedAsync(int page, int pageSize, string? search, int currentUserId, string callerRole);
}
