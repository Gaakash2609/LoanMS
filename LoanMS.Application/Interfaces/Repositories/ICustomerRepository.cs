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
    /// <summary>Like EmailExistsAsync/PanExistsAsync but also counts SOFT-DELETED
    /// customers — the DB unique indexes on Email/PanNumber include them.</summary>
    Task<bool> EmailTakenIncludingDeletedAsync(string email, int? excludeId = null);
    Task<bool> PanTakenIncludingDeletedAsync(string pan, int? excludeId = null);

    /// <summary>GLOBAL identity lookup on the normalised keys — no user scope,
    /// soft-deleted customers included. Arguments must already be normalised
    /// (Customer.NormalizePan / NormalizeMobile / NormalizeEmail); null = not supplied.</summary>
    Task<List<CustomerIdentityRow>> FindByIdentityKeysAsync(string? pan, string? mobile, string? email);
    Task<CustomerIdentityRow?> GetIdentityRowAsync(int customerId);
    /// <summary>True when the customer exists only for this one draft
    /// application: no other application (deleted ones included) and no bureau
    /// report reference it — i.e. it is safe to supersede.</summary>
    Task<bool> IsProvisionalForLoanAsync(int customerId, int loanId);
    /// <summary>Serialises concurrent identification/creation for the same
    /// normalised identifiers (PostgreSQL transaction-scoped advisory locks,
    /// taken in a fixed order). No-op outside a transaction / on other providers.</summary>
    Task LockIdentityKeysAsync(string? pan, string? mobile, string? email);
}
