using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

public interface ILoanRepository : IGenericRepository<Loan>
{
    // Phase 2B: currentUserId/currentUserRole are optional so internal callers
    // (post-create/update refetch, AI service) keep their existing unrestricted
    // behavior. Pass both when serving a caller-facing "detail by id" request so
    // the same role-based visibility scope used in GetPagedAsync is enforced —
    // this is what blocks direct loanId-swap access to someone else's loan.
    Task<Loan?> GetWithDetailsAsync(int id, int? currentUserId = null, string? currentUserRole = null);
    Task<PagedResultDto<LoanListDto>> GetPagedAsync(LoanFilterDto filter, int? currentUserId = null, string? currentUserRole = null);
    // Applications → Export: same filters/visibility scope as GetPagedAsync,
    // but returns up to a capped set of matching rows (not paginated) for a
    // CSV download. See LoansController.Export.
    Task<List<LoanListDto>> GetForExportAsync(LoanFilterDto filter, int? currentUserId = null, string? currentUserRole = null, int maxRows = 5000);
    // Productivity audit (P1) — latest persisted BureauReport.RiskGrade for
    // a customer, null if none exists. Used to surface risk on the single-
    // loan detail view (LoanDto.RiskGrade) the same way the list views
    // already do inline.
    Task<string?> GetLatestRiskGradeAsync(int customerId);
    Task<string> GenerateLoanNumberAsync();
    Task<DashboardStatsDto> GetDashboardStatsAsync(int? userId = null, string? role = null);
    Task<IEnumerable<Loan>> GetLoansByCustomerAsync(int customerId);
    // Phase 3A: reuses the same ApplyVisibilityScope rules that gate the list/
    // detail endpoints (Phase 2B) — the single source of truth for "can this
    // user see/act on this loan", now also used to gate Update/UpdateStatus/
    // Submit/Approve/Reject/Delete before any write happens.
    Task<bool> HasAccessAsync(int loanId, int currentUserId, string? currentUserRole);
}
