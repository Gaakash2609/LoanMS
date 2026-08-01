using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

public interface ICustomerRepository : IGenericRepository<Customer>
{
    Task<Customer?> GetWithLoansAsync(int id);
    Task<PagedResultDto<CustomerDto>> GetPagedAsync(int page, int pageSize, string? search);
    Task<bool> EmailExistsAsync(string email, int? excludeId = null);
    Task<bool> PanExistsAsync(string pan, int? excludeId = null);
}
