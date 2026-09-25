using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

public interface ILoanService
{
    // Phase 2B: currentUserId is required now (not defaulted) so every detail-by-id
    // lookup is checked against the caller's role-based visibility scope —
    // changing the loanId in the URL to someone else's loan must return "not found".
    Task<ApiResponseDto<LoanDto>> GetByIdAsync(int id, int currentUserId, string callerRole = "Sales", HashSet<string>? deniedTabs = null);
    Task<ApiResponseDto<PagedResultDto<LoanListDto>>> GetAllAsync(LoanFilterDto filter, int currentUserId, string currentUserRole);
    // Applications → Export: same filters/visibility scope as GetAllAsync,
    // capped, unpaginated — see LoanRepository.GetForExportAsync.
    Task<List<LoanListDto>> ExportAsync(LoanFilterDto filter, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<LoanDto>> CreateAsync(CreateLoanRequestDto request, int createdByUserId, string? callerRole = null);
    /// <summary>Central duplicate-application + 45-day guard (read-only
    /// evaluation). excludeLoanId = the application being submitted/reopened.</summary>
    Task<ApplicationEligibilityDto> CheckApplicationEligibilityAsync(int customerId, int? excludeLoanId = null);
    /// <summary>Same guard, but first takes the per-customer application lock —
    /// call inside the transaction that performs the create/reactivate write.</summary>
    Task<ApplicationEligibilityDto> GuardApplicationAsync(int customerId, int? excludeLoanId = null);
    /// <summary>Soft-archive a closed/rejected application (reason mandatory;
    /// Admin / ProductTeam / LocationHead within their scope).</summary>
    Task<ApiResponseDto<LoanDto>> ArchiveAsync(int id, string? reason, int userId, string role);
    // Phase 3A: every action on an existing loan now takes the caller's id/role
    // (always sourced from the JWT via BaseController — never from the request
    // body) and verifies access via ILoanRepository.HasAccessAsync before acting.
    Task<ApiResponseDto<LoanDto>> UpdateAsync(int id, UpdateLoanRequestDto request, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<LoanDto>> UpdateStatusAsync(int id, UpdateLoanStatusRequestDto request, int changedByUserId, string changedByUserRole);
    /// <summary>Phase 2 RBAC — G-08. Admin-only stage override: move a loan to
    /// ANY status, bypassing the normal GetAllowedTransitions state machine, with
    /// a MANDATORY reason recorded in LoanStatusHistory. Intended to be called
    /// only behind an Admin role gate; the reason and old→new are additionally
    /// written to the structured AuditLog by the controller.</summary>
    Task<ApiResponseDto<LoanDto>> OverrideStatusAsync(int id, LoanMS.Domain.Enums.LoanStatus newStatus, string reason, int changedByUserId, string changedByUserRole);

    Task<ApiResponseDto<LoanDto>> ReopenAsync(int id, string reason, int changedByUserId, string changedByUserRole);
    /// <summary>Pause an in-flight loan (Submitted/UnderReview/Approved → OnHold). Reason required.</summary>
    Task<ApiResponseDto<LoanDto>> HoldAsync(int id, string reason, int changedByUserId, string changedByUserRole);
    /// <summary>Resume a held loan, restoring the status it had before it was put OnHold.</summary>
    Task<ApiResponseDto<LoanDto>> UnholdAsync(int id, string? comment, int changedByUserId, string changedByUserRole);
    /// <summary>Stage notification email for a transition made by the offer workflow (non-fatal).</summary>
    Task NotifyStageChangeAsync(int loanId, LoanMS.Domain.Enums.LoanStatus newStatus, string? comment);
    Task<ApiResponseDto<LoanDto>> UpdateAssignmentAsync(int id, UpdateLoanAssignmentRequestDto request, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<LoanDto>> UpdateLenderRmAsync(int id, UpdateLenderRmRequestDto request, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<LoanDto>> UpdateOverviewAsync(int id, UpdateLoanOverviewRequestDto request, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<LoanDto>> UpdateBankLinesAsync(int id, UpdateLoanBankLinesRequestDto request, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<LoanDto>> UpdateReferencesAsync(int id, List<UpdateLoanReferenceItemDto> request, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<bool>> DeleteAsync(int id, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<DashboardStatsDto>> GetDashboardStatsAsync(int userId, string role);
    Task<ApiResponseDto<LoanFilterOptionsDto>> GetFilterOptionsAsync(int userId, string role);
}
