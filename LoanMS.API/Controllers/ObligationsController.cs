using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LoanMS.API.Controllers;

// ── RBAC note ─────────────────────────────────────────────────────────────
// Obligations are part of a loan application's detail view, so authorization
// here deliberately mirrors LoansController.Update exactly (per product
// instruction): Create/Update/Import = "Admin,Manager,Sales"; Delete = "Admin"
// only (same destructive-action convention as LoansController.Delete). Verify
// is a SUPERVISORY credit-review decision restricted to
// "Admin,Manager,OperationManager" — front-line Sales users who record an
// obligation cannot confirm/reject their own entries. Admin is included as a
// platform-level override path (e.g. correcting mis-flagged obligations that
// have no active Manager/OM in scope). Every write is additionally checked
// against the fine-grained canEditObligations permission, and every read
// against canViewObligations. Loan-visibility scope is enforced in the service
// (ILoanService) so an obligation cannot be read or written for a loan outside
// the caller's scope even if an id is guessed directly.
[Authorize]
public class ObligationsController : BaseController
{
    private const string WriteRoles = "Admin,Manager,Sales";
    // Supervisory reviewers who may confirm/reject an obligation.
    // Admin is included as a platform-level override path alongside
    // Manager and OperationManager (the day-to-day supervisory roles).
    private const string ReviewerRoles = "Admin,Manager,OperationManager";

    private readonly IObligationService _service;
    private readonly ILoanService _loanService;
    private readonly LoanMS.API.Services.IRolePermissionService _rolePerm;

    public ObligationsController(IObligationService service, ILoanService loanService, LoanMS.API.Services.IRolePermissionService rolePerm)
    {
        _service = service;
        _loanService = loanService;
        _rolePerm = rolePerm;
    }

    private async Task<bool> InScopeAsync(int loanId)
        => (await _loanService.GetByIdAsync(loanId, CurrentUserId, CurrentUserRole)).Success;

    // ── Reads ─────────────────────────────────────────────────────────────────
    /// <summary>All obligations for a loan (flat list — backward compatible).</summary>
    [HttpGet("/api/loans/{loanId:int}/obligations")]
    public async Task<IActionResult> GetByLoan(int loanId)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canViewObligations")) return Forbid();
        if (!await InScopeAsync(loanId)) return NotFound();
        return ApiResult(await _service.GetByLoanAsync(loanId, CurrentUserId, CurrentUserRole));
    }

    /// <summary>The whole credit-review workspace: obligations + summary + FOIR +
    /// reconciliation, all computed server-side.</summary>
    [HttpGet("/api/loans/{loanId:int}/obligations/workspace")]
    public async Task<IActionResult> GetWorkspace(int loanId,
        [FromQuery] decimal? proposedEmi, [FromQuery] decimal? coApplicantIncome,
        [FromQuery] int? foirOverride,
        [FromQuery] string? applicantRole, [FromQuery] string? applicantKey)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canViewObligations")) return Forbid();
        if (!await InScopeAsync(loanId)) return NotFound();
        var whatIf = new CalculateFoirRequestDto
        {
            ProposedEmi = proposedEmi, CoApplicantIncome = coApplicantIncome,
            FoirOverride = foirOverride,
            ApplicantRole = applicantRole, ApplicantKey = applicantKey,
        };
        return ApiResult(await _service.GetWorkspaceAsync(loanId, whatIf, CurrentUserId, CurrentUserRole));
    }

    /// <summary>Authoritative FOIR for the loan (optionally with what-if inputs).</summary>
    [HttpPost("/api/loans/{loanId:int}/obligations/calculate-foir")]
    public async Task<IActionResult> CalculateFoir(int loanId, [FromBody] CalculateFoirRequestDto? request)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canViewObligations")) return Forbid();
        if (!await InScopeAsync(loanId)) return NotFound();
        return ApiResult(await _service.CalculateFoirAsync(loanId, request ?? new CalculateFoirRequestDto(), CurrentUserId, CurrentUserRole));
    }

    /// <summary>Detect recurring EMI/mandate debits from the loan's persisted Perfios
    /// statement (preview — nothing is written).</summary>
    [HttpPost("/api/loans/{loanId:int}/obligations/detect")]
    public async Task<IActionResult> Detect(int loanId)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canViewObligations")) return Forbid();
        if (!await InScopeAsync(loanId)) return NotFound();
        return ApiResult(await _service.DetectAsync(loanId, CurrentUserId, CurrentUserRole));
    }

    /// <summary>Persist chosen detected candidates as ReviewRequired obligations.</summary>
    [HttpPost("/api/loans/{loanId:int}/obligations/import-detected")]
    [Authorize(Roles = WriteRoles)]
    public async Task<IActionResult> ImportDetected(int loanId, [FromBody] ImportDetectedObligationsRequestDto request)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canEditObligations")) return Forbid();
        if (!await InScopeAsync(loanId)) return NotFound();
        return ApiResult(await _service.ImportDetectedAsync(loanId, request ?? new ImportDetectedObligationsRequestDto(), CurrentUserId, CurrentUserRole));
    }

    // ── Writes ────────────────────────────────────────────────────────────────
    /// <summary>Add a new obligation to a loan application.</summary>
    [HttpPost]
    [Authorize(Roles = WriteRoles)]
    public async Task<IActionResult> Create([FromBody] CreateLoanObligationRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<LoanObligationDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canEditObligations")) return Forbid();
        return ApiResult(await _service.CreateAsync(request, CurrentUserId, CurrentUserRole));
    }

    /// <summary>Update an existing obligation.</summary>
    [HttpPut("{id:int}")]
    [Authorize(Roles = WriteRoles)]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateLoanObligationRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<LoanObligationDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canEditObligations")) return Forbid();
        return ApiResult(await _service.UpdateAsync(id, request, CurrentUserId, CurrentUserRole));
    }

    /// <summary>Supervisory reviewer confirms/rejects an obligation (Manager /
    /// Operation Manager / Admin only — not front-line Sales).</summary>
    [HttpPost("{id:int}/verify")]
    [Authorize(Roles = ReviewerRoles)]
    public async Task<IActionResult> Verify(int id, [FromBody] VerifyObligationRequestDto request)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canEditObligations")) return Forbid();
        return ApiResult(await _service.VerifyAsync(id, request ?? new VerifyObligationRequestDto(), CurrentUserId, CurrentUserRole));
    }

    /// <summary>Delete an obligation [Admin only] — same convention as LoansController.Delete.</summary>
    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id)
        => ApiResult(await _service.DeleteAsync(id, CurrentUserId, CurrentUserRole));
}
