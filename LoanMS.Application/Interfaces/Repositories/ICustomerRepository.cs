using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

public interface ICustomerRepository : IGenericRepository<Customer>
{
    // Phase 4 (Customer Visibility): currentUserId/currentUserRole are optional
    // so internal callers (Create/Update/Delete lookups, AI service, loan
    // creation) keep their existing unrestricted behavior — only caller-facing
    // read surfaces (GetAll/GetById/Search/GetPaged) pass both to enforce the
    // same role-based scope used for Loans.
    Task<Customer?> GetWithLoansAsync(int id, int? currentUserId = null, string? currentUserRole = null);
    Task<PagedResultDto<CustomerDto>> GetPagedAsync(int page, int pageSize, string? search, int? currentUserId = null, string? currentUserRole = null);
    Task<bool> EmailExistsAsync(string email, int? excludeId = null);
    Task<bool> PanExistsAsync(string pan, int? excludeId = null);
}
