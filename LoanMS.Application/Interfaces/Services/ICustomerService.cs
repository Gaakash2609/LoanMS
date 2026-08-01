using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

public interface ICustomerService
{
    Task<ApiResponseDto<CustomerDto>> GetByIdAsync(int id, string callerRole = "Sales");
    Task<ApiResponseDto<PagedResultDto<CustomerDto>>> GetAllAsync(int page, int pageSize, string? search);
    Task<ApiResponseDto<CustomerDto>> CreateAsync(CreateCustomerRequestDto request);
    Task<ApiResponseDto<CustomerDto>> UpdateAsync(int id, UpdateCustomerRequestDto request);
    Task<ApiResponseDto<bool>> DeleteAsync(int id);
    Task<bool> PanExistsAsync(string pan, int? excludeId = null);
    Task<PagedResultDto<CustomerDto>> GetPagedAsync(int page, int pageSize, string? search);
}
