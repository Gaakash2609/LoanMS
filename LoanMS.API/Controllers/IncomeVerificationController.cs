using LoanMS.Application.DTOs.IncomeVerification;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LoanMS.API.Controllers;

// ── Income Verification API (Phase 5) ─────────────────────────────────────────
// The authoritative surface. Every endpoint first checks the caller's loan
// visibility scope via ILoanService.GetByIdAsync (same convention as
// PerfiosController/TrackingController), so a report can't be read/written for a
// loan outside the caller's scope even by guessing the id. Results are computed
// and persisted server-side — the client can trigger and read, never assert.
[Authorize]
public class IncomeVerificationController : BaseController
{
    private const string OperationalRoles =
        "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager";
    // Manual review is a supervisory decision — the front-line LoginTeam that runs
    // the check does not approve its own failed auto-verification (§15 authorized reviewer).
    private const string ReviewerRoles =
        "Admin,Manager,TeamLeader,LocationHead,OperationManager";

    private readonly IIncomeVerificationService _service;
    private readonly ILoanService _loanService;

    public IncomeVerificationController(IIncomeVerificationService service, ILoanService loanService)
    {
        _service = service;
        _loanService = loanService;
    }

    private async Task<bool> InScopeAsync(int loanId)
    {
        var loan = await _loanService.GetByIdAsync(loanId, CurrentUserId, CurrentUserRole);
        return loan.Success;
    }

    /// <summary>Run (or re-run) authoritative income verification and persist it.</summary>
    [HttpPost("/api/loans/{loanId:int}/income-verification/run")]
    [Authorize(Roles = OperationalRoles)]
    public async Task<IActionResult> Run(int loanId, [FromBody] RunIncomeVerificationRequestDto request)
    {
        if (!await InScopeAsync(loanId)) return NotFound();
        return ApiResult(await _service.RunAsync(loanId, request ?? new RunIncomeVerificationRequestDto(), CurrentUserId));
    }

    /// <summary>Latest persisted result for an applicant.</summary>
    [HttpGet("/api/loans/{loanId:int}/income-verification")]
    [Authorize(Roles = OperationalRoles)]
    public async Task<IActionResult> GetLatest(int loanId,
        [FromQuery] ApplicantRole applicantRole = ApplicantRole.Applicant, [FromQuery] string? applicantKey = null)
    {
        if (!await InScopeAsync(loanId)) return NotFound();
        return ApiResult(await _service.GetLatestAsync(loanId, applicantRole, applicantKey));
    }

    /// <summary>Append-only history of every run for the loan (§14 audit).</summary>
    [HttpGet("/api/loans/{loanId:int}/income-verification/history")]
    [Authorize(Roles = OperationalRoles)]
    public async Task<IActionResult> GetHistory(int loanId)
    {
        if (!await InScopeAsync(loanId)) return NotFound();
        return ApiResult(await _service.GetHistoryAsync(loanId));
    }

    /// <summary>Authorized reviewer completes a manual review.</summary>
    [HttpPost("/api/loans/{loanId:int}/income-verification/{verificationId:int}/manual-review")]
    [Authorize(Roles = ReviewerRoles)]
    public async Task<IActionResult> ManualReview(int loanId, int verificationId, [FromBody] ManualReviewRequestDto request)
    {
        if (!await InScopeAsync(loanId)) return NotFound();
        return ApiResult(await _service.SubmitManualReviewAsync(loanId, verificationId, request, CurrentUserId));
    }

    /// <summary>Record a user salary override on a slip (never overwrites the original).</summary>
    [HttpPut("/api/loans/{loanId:int}/income-verification/salary-slip/{extractionId:int}/override")]
    [Authorize(Roles = OperationalRoles)]
    public async Task<IActionResult> SetOverride(int loanId, int extractionId, [FromBody] SalaryOverrideRequestDto request)
    {
        if (!await InScopeAsync(loanId)) return NotFound();
        return ApiResult(await _service.SetSalaryOverrideAsync(loanId, extractionId, request, CurrentUserId));
    }
}
