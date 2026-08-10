using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Interfaces;

public interface ILoanService
{
    // Phase 2B: currentUserId is required now (not defaulted) so every detail-by-id
    // lookup is checked against the caller's role-based visibility scope —
    // changing the loanId in the URL to someone else's loan must return "not found".
    Task<ApiResponseDto<LoanDto>> GetByIdAsync(int id, int currentUserId, string callerRole = "Sales");
    Task<ApiResponseDto<PagedResultDto<LoanListDto>>> GetAllAsync(LoanFilterDto filter, int currentUserId, string currentUserRole);
    // Applications → Export: same filters/visibility scope as GetAllAsync,
    // capped, unpaginated — see LoanRepository.GetForExportAsync.
    Task<List<LoanListDto>> ExportAsync(LoanFilterDto filter, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<LoanDto>> CreateAsync(CreateLoanRequestDto request, int createdByUserId);
    // Phase 3A: every action on an existing loan now takes the caller's id/role
    // (always sourced from the JWT via BaseController — never from the request
    // body) and verifies access via ILoanRepository.HasAccessAsync before acting.
    Task<ApiResponseDto<LoanDto>> UpdateAsync(int id, UpdateLoanRequestDto request, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<LoanDto>> UpdateStatusAsync(int id, UpdateLoanStatusRequestDto request, int changedByUserId, string changedByUserRole);
    Task<ApiResponseDto<bool>> DeleteAsync(int id, int currentUserId, string currentUserRole);
    Task<ApiResponseDto<DashboardStatsDto>> GetDashboardStatsAsync(int userId, string role);
}
