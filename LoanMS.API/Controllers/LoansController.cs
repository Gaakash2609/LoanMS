using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

[Authorize]
public class LoansController : BaseController
{
    private readonly ILoanService _loanService;
    private readonly AppDbContext _db;
    private readonly LoanMS.Application.Interfaces.IFileStorageService _fileStorage;
    private readonly LoanMS.API.Services.IRolePermissionService _rolePerm;
    // Global customer identification for GET duplicate-check (always injected
    // by DI; optional only so older unit-test constructions keep compiling).
    private readonly ICustomerService? _customerService;

    public LoansController(ILoanService loanService, AppDbContext db, LoanMS.Application.Interfaces.IFileStorageService fileStorage, LoanMS.API.Services.IRolePermissionService rolePerm,
        ICustomerService? customerService = null)
    {
        _loanService = loanService;
        _db          = db;
        _fileStorage = fileStorage;
        _rolePerm    = rolePerm;
        _customerService = customerService;
    }

    private static bool IsEligibilityBlock(string? code) => code is ApiErrorCodes.ActiveApplicationExists
        or ApiErrorCodes.ReapplyCooldown or ApiErrorCodes.RejectionDateUnknown or ApiErrorCodes.CustomerNeedsReview;

    /// <summary>Audit trail for an application attempt the central guard
    /// refused (existing AuditLog pattern; the global AuditMiddleware only
    /// records successful writes). Best-effort: never turns a 409 into a 500.</summary>
    private async Task AuditBlockedApplicationAsync<T>(string entityId, string attempted, ApiResponseDto<T> result)
    {
        if (!IsEligibilityBlock(result.ErrorCode)) return;
        try
        {
            _db.ChangeTracker.Clear();
            AuditHelper.LogChange(_db, HttpContext, "Loans", entityId, "ApplicationBlocked",
                oldValues: null, newValues: attempted,
                reason: $"{result.ErrorCode}: {result.Errors.FirstOrDefault()}",
                userId: CurrentUserId, userName: CurrentUserEmail);
            await _db.SaveChangesAsync();
        }
        catch { /* audit is best-effort here; the block itself already stands */ }
    }

    /// <summary>Get dashboard statistics</summary>
    /// <summary>Distinct values for the Applications Advanced Filter dropdowns (caller's scope).</summary>
    [HttpGet("filter-options")]
    public async Task<IActionResult> GetFilterOptions() =>
        Ok(await _loanService.GetFilterOptionsAsync(CurrentUserId, CurrentUserRole));

    [HttpGet("dashboard")]
    public async Task<IActionResult> GetDashboard()
    {
        var result = await _loanService.GetDashboardStatsAsync(CurrentUserId, CurrentUserRole);
        return Ok(result);
    }

    /// <summary>Get all loans (paged, filtered)</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] LoanFilterDto filter)
    {
        if (filter.Page < 1) filter.Page = 1;
        if (filter.PageSize is < 1 or > 100) filter.PageSize = 10;

        var result = await _loanService.GetAllAsync(filter, CurrentUserId, CurrentUserRole);
        return Ok(result);
    }

    /// <summary>
    /// Get loan by ID. Role-based visibility is enforced server-side (see
    /// ILoanRepository.ApplyVisibilityScope) — passing someone else's loanId
    /// here returns 404, not the loan's data.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        // Tab Data Access (Roles & Permissions matrix) — resolved here
        // (controller has DB access via IRolePermissionService) and passed
        // down to the Application-layer service as a plain HashSet, since
        // LoanService can't reference this API-layer service directly (see
        // RolePermissionService's own doc comment for why it lives here).
        var deniedTabs = await _rolePerm.GetDeniedPermissionsAsync(CurrentUserRole,
            new[] { "canViewPersonal", "canViewAddress", "canViewEmployment", "canViewReferences" });

        var result = await _loanService.GetByIdAsync(id, CurrentUserId, CurrentUserRole, deniedTabs);
        if (!result.Success) return NotFound(result);
        return Ok(result);
    }

    /// <summary>Create new loan application</summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateLoanRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<LoanDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canCreateApp"))
            return Forbid();

        var result = await _loanService.CreateAsync(request, CurrentUserId, CurrentUserRole);
        if (!result.Success)
        {
            await AuditBlockedApplicationAsync($"customer:{request.CustomerId}", "POST /api/loans", result);
            return ApiResult(result);
        }
        return CreatedAtAction(nameof(GetById), new { id = result.Data!.Id }, result);
    }

    /// <summary>
    /// Update loan details (Draft/Submitted only).
    /// [Roles with canEditDetails:true in the frontend ROLES matrix]
    /// — DSA/Partner/Accounts never get automatic edit rights.
    /// Ownership/location scope is verified server-side before the write
    /// (see ILoanRepository.HasAccessAsync) — a loanId outside the caller's
    /// scope returns "not found", it does not execute the update.
    /// </summary>
    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin,Manager,Sales,LoginTeam,TeamLeader,LocationHead,OperationManager,ProductTeam")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateLoanRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<LoanDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canEditDetails"))
            return Forbid();

        var result = await _loanService.UpdateAsync(id, request, CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    /// <summary>
    /// Update loan status [Roles with canChangeStatus:true in the frontend
    /// ROLES matrix]. Manager's existing location restriction is enforced
    /// here too — approving/rejecting a loan outside their authorized
    /// location now fails the same access check as viewing it.
    /// </summary>
    [HttpPatch("{id:int}/status")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager")]
    public async Task<IActionResult> UpdateStatus(int id, [FromBody] UpdateLoanStatusRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<LoanDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        // Server-side enforcement of the Admin-configurable Roles &
        // Permissions matrix (Settings screen) — was previously frontend-UI
        // only (button hidden, but the same status-change still succeeded
        // if called directly). This checks it ON TOP OF the fixed
        // [Authorize(Roles=...)] list above, never instead of it — a role
        // not in that list still gets a 401/403 before this code even
        // runs. Only the specific action → permission-key mapping the
        // Settings screen already exposes for is checked; permissions with
        // no clean backend equivalent (e.g. Hold, which has no LoanStatus
        // value at all) are intentionally left as-is, not guessed at.
        var permKey = request.NewStatus switch
        {
            LoanStatus.Rejected  => "canRejectApp",
            LoanStatus.Disbursed => "canDisburse",
            _                    => "canChangeStatus"
        };
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, permKey))
            return Forbid();

        var result = await _loanService.UpdateStatusAsync(id, request, CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    /// <summary>
    /// Phase 2 RBAC — G-08. Admin stage override: force a loan to any status,
    /// bypassing the normal state machine. Admin-only, reason mandatory. On
    /// success writes a structured AuditLog row capturing old→new status, the
    /// reason, the acting user and IP — the auditable override trail required by
    /// the Phase 1 audit. The state machine for every non-Admin transition
    /// endpoint is untouched.
    /// </summary>
    [HttpPatch("{id:int}/override-status")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> OverrideStatus(int id, [FromBody] OverrideStatusRequestDto request)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.Reason))
            return BadRequest(ApiResponseDto<LoanDto>.Fail("An override reason is required."));

        // Capture the pre-override status for the audit before the mutation.
        var before = await _db.Set<Loan>().AsNoTracking()
            .Where(l => l.Id == id).Select(l => (LoanStatus?)l.Status).FirstOrDefaultAsync();

        var result = await _loanService.OverrideStatusAsync(id, request.NewStatus, request.Reason, CurrentUserId, CurrentUserRole);
        if (!result.Success)
        {
            await AuditBlockedApplicationAsync(id.ToString(), $"override-status → {request.NewStatus}", result);
            return ApiResult(result);
        }

        // Structured audit entry (old→new + reason). This is IN ADDITION to the
        // global AuditMiddleware row and to LoanStatusHistory — it is the one
        // that carries a populated OldValues + Reason for this sensitive action.
        _db.AuditLogs.Add(new AuditLog
        {
            EntityName = "Loans",
            Action     = "StageOverride",
            EntityId   = id.ToString(),
            OldValues  = before?.ToString(),
            NewValues  = request.NewStatus.ToString(),
            Reason     = request.Reason,
            UserId     = CurrentUserId,
            UserName   = CurrentUserEmail,
            IpAddress  = HttpContext.Connection.RemoteIpAddress?.ToString(),
            CreatedAt  = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();

        return Ok(result);
    }

    /// <summary>
    /// Re-open a Rejected loan [Admin-only — Vanilla parity for reopenApp,
    /// efin-app.js:10600]. 45-day window from creation date + restore to the
    /// pre-rejection stage are enforced in LoanService.ReopenAsync; this
    /// action only adds the same structured audit-log entry OverrideStatus
    /// writes above, for the same reason (sensitive, needs OldValues+Reason
    /// beyond what LoanStatusHistory carries).
    /// </summary>
    [HttpPatch("{id:int}/reopen")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Reopen(int id, [FromBody] ReopenRequestDto request)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.Reason))
            return BadRequest(ApiResponseDto<LoanDto>.Fail("A remark is required to re-open this application."));

        var before = await _db.Set<Loan>().AsNoTracking()
            .Where(l => l.Id == id).Select(l => (LoanStatus?)l.Status).FirstOrDefaultAsync();

        var result = await _loanService.ReopenAsync(id, request.Reason, CurrentUserId, CurrentUserRole);
        if (!result.Success)
        {
            await AuditBlockedApplicationAsync(id.ToString(), "reopen", result);
            return ApiResult(result);
        }

        _db.AuditLogs.Add(new AuditLog
        {
            EntityName = "Loans",
            Action     = "Reopen",
            EntityId   = id.ToString(),
            OldValues  = before?.ToString(),
            NewValues  = result.Data?.Status.ToString(),
            Reason     = request.Reason,
            UserId     = CurrentUserId,
            UserName   = CurrentUserEmail,
            IpAddress  = HttpContext.Connection.RemoteIpAddress?.ToString(),
            CreatedAt  = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();

        return Ok(result);
    }

    /// <summary>
    /// Archive a closed/rejected application (soft, application-level; reason
    /// mandatory). Role gate here AND in LoanService.ArchiveAsync: Admin (Chief
    /// Administrator), ProductTeam (Product &amp; Risk Officer), LocationHead
    /// (Zonal Manager) — within their normal loan visibility scope. The
    /// structured audit row is written in the SAME SaveChanges as the archive,
    /// so an archive can never persist without its audit entry.
    /// </summary>
    [HttpPatch("{id:int}/archive")]
    [Authorize(Roles = "Admin,ProductTeam,LocationHead")]
    public async Task<IActionResult> Archive(int id, [FromBody] ArchiveLoanRequestDto? request)
    {
        var before = await _db.Set<Loan>().AsNoTracking()
            .Where(l => l.Id == id).Select(l => new { l.Status, l.IsArchived }).FirstOrDefaultAsync();

        AuditLog? audit = null;
        if (before != null && !string.IsNullOrWhiteSpace(request?.Reason))
        {
            audit = new AuditLog
            {
                EntityName = "Loans",
                Action     = "Archived",
                EntityId   = id.ToString(),
                OldValues  = $"IsArchived={before.IsArchived}; Status={before.Status}",
                NewValues  = "IsArchived=True",
                Reason     = request.Reason.Trim(),
                UserId     = CurrentUserId,
                UserName   = CurrentUserEmail,
                IpAddress  = HttpContext.Connection.RemoteIpAddress?.ToString(),
                CreatedAt  = DateTime.UtcNow
            };
            _db.AuditLogs.Add(audit);
        }

        var result = await _loanService.ArchiveAsync(id, request?.Reason, CurrentUserId, CurrentUserRole);
        if (!result.Success)
        {
            if (audit != null) _db.Entry(audit).State = EntityState.Detached;
            return ApiResult(result);
        }
        return Ok(result);
    }

    /// <summary>
    /// 🔴 CRITICAL — bulk status update (item #3). Reuses UpdateStatusAsync
    /// PER LOAN — the exact same HasAccessAsync visibility check and
    /// GetAllowedTransitions validation that already gate the single-loan
    /// endpoint above, not a second/looser authorization path. A caller
    /// seeing 100 loans in a list does NOT mean they're authorized to
    /// modify all 100 — each id is individually re-checked here exactly as
    /// if PATCH /{id}/status had been called on it one at a time. Partial
    /// failure is expected and safe: one unauthorized/invalid id in the
    /// batch does not roll back or block the others — each succeeds or
    /// fails independently, and the response reports both lists so the
    /// caller can see exactly what happened. Capped at 100 ids per call to
    /// bound the work of one request.
    /// </summary>
    [HttpPatch("bulk-status")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager")]
    public async Task<IActionResult> BulkUpdateStatus([FromBody] BulkUpdateStatusRequestDto request)
    {
        if (request.LoanIds == null || request.LoanIds.Count == 0)
            return BadRequest(ApiResponseDto<object>.Fail("At least one loan id is required."));
        if (request.LoanIds.Count > 100)
            return BadRequest(ApiResponseDto<object>.Fail("Bulk actions are limited to 100 loans per request."));
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<object>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var succeeded = new List<int>();
        var failed    = new List<object>();

        foreach (var loanId in request.LoanIds.Distinct())
        {
            var statusReq = new UpdateLoanStatusRequestDto { NewStatus = request.NewStatus, Comment = request.Comment, ApprovedAmount = null };
            var result = await _loanService.UpdateStatusAsync(loanId, statusReq, CurrentUserId, CurrentUserRole);
            if (result.Success) succeeded.Add(loanId);
            else failed.Add(new { loanId, error = result.Errors?.FirstOrDefault() ?? result.Message ?? "Update failed." });
        }

        return Ok(ApiResponseDto<object>.Ok(new
        {
            totalRequested = request.LoanIds.Count,
            succeededCount = succeeded.Count,
            failedCount    = failed.Count,
            succeeded,
            failed
        }, $"{succeeded.Count} of {request.LoanIds.Count} loan(s) updated."));
    }

    /// <summary>
    /// Submit loan (Draft → Submitted). Access (own/assigned/linked/authorized-
    /// location loan) is verified before the transition — no role list is
    /// added beyond what already existed, only the missing ownership check.
    /// </summary>
    // BUGFIX (confirmed real, independent-of-frontend audit): this had NEITHER
    // a role-list [Authorize] NOR the fine-grained _rolePerm check every
    // sibling transition below has -- the class-level [Authorize] on this
    // controller is bare, so ANY authenticated role, on ANY loan they can
    // already see via HasAccessAsync, could submit it. The frontend gates
    // this button on canCreateApp (LoanDetailPage.tsx ACTION_PERM), which
    // matches the fact that this transition is meant for the same roles who
    // create applications (Sales/Dsa/Partner et al), not the narrower
    // approve/reject/disburse set -- so this does NOT reuse the other four
    // endpoints' 6-role list, which would have been too strict for exactly
    // the roles meant to submit their own applications.
    [HttpPatch("{id:int}/submit")]
    [Authorize]
    public async Task<IActionResult> Submit(int id)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canCreateApp"))
            return Forbid();

        var result = await _loanService.UpdateStatusAsync(id,
            new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Submitted, Comment = "Submitted for review." },
            CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    // ── Retired: offer-chain transitions ─────────────────────────────────────
    // Approve (credit approval), Disburse and the loan-level deviation
    // raise/decide/skip/flags endpoints were replaced by the Offer workflow
    // (/api/loans/{id}/workflow/..., OfferWorkflowController). They stay routed
    // so an old client (e.g. the unused legacy api-bridge.js) gets an explicit
    // 409 with directions instead of a silent 404 or — worse — a bypass of the
    // offer / deviation / credit-approval / sanction chain.
    private IActionResult Retired(string action, string replacement) =>
        Conflict(ApiResponseDto<object>.Fail(
            $"{action} is no longer a direct loan action. Use the Offers tab: {replacement}.", ApiErrorCodes.WorkflowStage));

    [HttpPatch("{id:int}/approve")]
    public IActionResult Approve(int id) =>
        Retired("Approve", "select the final offer, resolve any deviation, then Credit Approval (POST /api/loans/{id}/workflow/offers/{offerId}/credit-approval)");

    /// <summary>Reject loan [Roles with canRejectApp:true in the frontend ROLES matrix]</summary>
    [HttpPatch("{id:int}/reject")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager")]
    public async Task<IActionResult> Reject(int id, [FromBody] RejectRequestDto request)
    {
        // Same reasoning as Approve above -- matches UpdateStatus's own
        // canRejectApp check for this transition.
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canRejectApp"))
            return Forbid();

        var result = await _loanService.UpdateStatusAsync(id,
            new UpdateLoanStatusRequestDto
            {
                NewStatus = LoanStatus.Rejected,
                Comment   = request.Reason ?? "Loan rejected."
            },
            CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    [HttpPatch("{id:int}/disburse")]
    public IActionResult Disburse(int id) =>
        Retired("Disburse", "generate the sanction, then record the disbursement (POST /api/loans/{id}/workflow/disbursements)");

    /// <summary>
    /// Put an in-flight loan on hold [Roles with canHoldApp:true]. Restores
    /// the fixed-role gate + the fine-grained canHoldApp check, same
    /// two-layer pattern as the other transitions. Legacy exposed this as
    /// holdApp(); the current UI now surfaces it on Loan Detail. Reason is
    /// mandatory (recorded in the status-history comment).
    /// </summary>
    [HttpPatch("{id:int}/hold")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager")]
    public async Task<IActionResult> Hold(int id, [FromBody] HoldRequestDto request)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canHoldApp"))
            return Forbid();

        var result = await _loanService.HoldAsync(id, request?.Reason ?? "", CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    /// <summary>Release a held loan, restoring its pre-hold status [canHoldApp].</summary>
    [HttpPatch("{id:int}/unhold")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager")]
    public async Task<IActionResult> Unhold(int id, [FromBody] HoldRequestDto? request)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canHoldApp"))
            return Forbid();

        var result = await _loanService.UnholdAsync(id, request?.Reason, CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    [HttpGet("{id:int}/deviations")]
    public IActionResult GetDeviations(int id) =>
        Retired("Loan-level deviation flags", "each offer's rule-engine evaluation is in GET /api/loans/{id}/workflow");

    [HttpPatch("{id:int}/deviation/raise")]
    public IActionResult RaiseDeviation(int id) =>
        Retired("Raise deviation", "raise it on the selected final offer (POST /api/loans/{id}/workflow/offers/{offerId}/deviations)");

    [HttpPatch("{id:int}/deviation/decide")]
    public IActionResult DecideDeviation(int id) =>
        Retired("Deviation decision", "POST /api/loans/{id}/workflow/deviations/{deviationId}/decide");

    [HttpPatch("{id:int}/deviation/skip")]
    public IActionResult SkipDeviation(int id) =>
        Retired("Skip deviation", "POST /api/loans/{id}/workflow/offers/{offerId}/deviations/skip");

    /// <summary>
    /// Update Sales Team / Operations Manager assignment (linked-users
    /// visibility fix). Deliberately a separate, narrow endpoint rather
    /// than reusing PUT /{id} (UpdateAsync) — that endpoint requires every
    /// core loan field and only allows Draft/Submitted loans, but Sales
    /// Team / Operations Manager reassignment needs to work on a loan in
    /// any status, matching the frontend's Team & Assignment panel
    /// (canEditTeamAssignment allows every role except partner/sales/
    /// login/dsa — mirrored here). Same HasAccessAsync visibility check as
    /// every other loan-mutating endpoint; no new authorization path.
    /// </summary>
    [HttpPatch("{id:int}/assignment")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager,Accounts,ProductTeam")]
    public async Task<IActionResult> UpdateAssignment(int id, [FromBody] UpdateLoanAssignmentRequestDto request)
    {
        var result = await _loanService.UpdateAssignmentAsync(id, request, CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    /// <summary>
    /// Per-loan Lender RM override (Lender Email Workflow) — mirrors Vanilla's
    /// openRmOverrideModal / _lewSaveRmOverride. Sets the RM contact used for
    /// lender-email enquiries on THIS application without touching the master
    /// Bank/NBFC record. Same role gate as UpdateBankLines (bank/lender data).
    /// </summary>
    [HttpPatch("{id:int}/lender-rm")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager,Accounts,ProductTeam")]
    public async Task<IActionResult> UpdateLenderRm(int id, [FromBody] UpdateLenderRmRequestDto request)
    {
        if (!ModelState.IsValid)
            return BadRequest(ApiResponseDto<LoanDto>.Fail(
                ModelState.Values.SelectMany(v => v.Errors.Select(e => e.ErrorMessage)).ToList()));

        var result = await _loanService.UpdateLenderRmAsync(id, request, CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    /// <summary>
    /// Partial update of the Overview parity fields (Vanilla efin-app.js:2479):
    /// InCred RM, Analytic Bank, and the five underwriting verification flags.
    /// Same internal-role gate as the other routing/underwriting edits.
    /// </summary>
    [HttpPatch("{id:int}/overview")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager,Accounts,ProductTeam")]
    public async Task<IActionResult> UpdateOverview(int id, [FromBody] UpdateLoanOverviewRequestDto request)
    {
        var result = await _loanService.UpdateOverviewAsync(id, request, CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    /// <summary>
    /// Bank Details table ("Application Number" / "Approved Loan" / Remarks
    /// per bank a loan was sent to) — see LoanBankLine's own doc comment.
    /// Same role gate as UpdateAssignment above (matches the frontend's
    /// canEditRole check on the Bank Details edit toolbar: canChangeStatus
    /// OR admin OR login_team).
    /// </summary>
    [HttpPut("{id:int}/bank-lines")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager,Accounts,ProductTeam")]
    public async Task<IActionResult> UpdateBankLines(int id, [FromBody] UpdateLoanBankLinesRequestDto request)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canAddBank"))
            return Forbid();

        var result = await _loanService.UpdateBankLinesAsync(id, request, CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    /// <summary>References tab — whole-set replace, same convention as bank-lines.</summary>
    [HttpPut("{id:int}/references")]
    [Authorize(Roles = "Admin,Manager,Sales,LoginTeam,TeamLeader,LocationHead,OperationManager,ProductTeam")]
    public async Task<IActionResult> UpdateReferences(int id, [FromBody] List<UpdateLoanReferenceItemDto> request)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canEditDetails"))
            return Forbid();

        var result = await _loanService.UpdateReferencesAsync(id, request, CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    /// <summary>
    /// "Approval Details" / CAM panel — Stamp Duty/GST/Insurance/PF%/Bundled/BT/
    /// Flat Rate/EMI Date. Upserts a single row per loan.
    ///
    /// Authorization mirrors the legacy CAM edit rule (efin-app.js
    /// renderDetailApproval + efinIsAppLocked), NOT canChangeStatus: legacy lets
    /// the Sales person who created the loan and the channel Partner edit the CAM,
    /// so an earlier canChangeStatus gate here (and the matching Sales/Partner/Dsa
    /// omission from the role list) wrongly rejected exactly those users. Access
    /// to the loan itself is still enforced below by GetByIdAsync, which applies
    /// the per-role visibility scope (LoanRepository.ApplyVisibilityScope) — so a
    /// Sales/Partner user can only reach a loan already in their scope, the
    /// server-side equivalent of legacy's app-access check. The finalised-loan
    /// read-only rule stays a client concern (SanctionDetailCard), exactly as in
    /// legacy where the same backend serves the vanilla UI.
    /// </summary>
    // Sanction paperwork may be edited only by the 4 sanction authority roles
    // (Chief Administrator, Zonal Manager, Credit Evaluation Manager, Credit
    // Evaluation Officer) and never while an immutable Sanction is active —
    // the sanction snapshot (OfferWorkflowService) is then the source of truth
    // and this panel is display-only (a correction = sanction Amendment).
    [HttpPut("{id:int}/sanction-detail")]
    [Authorize(Roles = "Admin,LocationHead,OperationManager,LoginTeam")]
    public async Task<IActionResult> UpdateSanctionDetail(int id, [FromBody] UpdateLoanSanctionDetailRequestDto request)
    {
        var loan = await _loanService.GetByIdAsync(id, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(loan);
        if (await _db.Sanctions.AnyAsync(s => s.LoanId == id && s.Status == LoanMS.Domain.Entities.OfferWorkflowStatuses.SanctionActive))
            return Conflict(ApiResponseDto<bool>.Fail(
                "A sanction is active — its terms are immutable. Cancel it with type Amendment to correct them.", ApiErrorCodes.WorkflowStage));

        // Stage guard — sanction terms are recorded only once the loan is at/after the
        // approval step (legacy: the "Approve with Details" step is the only writer of
        // sanction data). UnderReview is allowed because the Approve-with-Details modal
        // saves the terms just before it moves the loan to Approved; Decision covers the
        // deviation-approval path. Anything earlier (Draft/Submitted, never approved)
        // is rejected so a sanction row can't exist for a loan at its initial stage.
        var stage = loan.Data;
        // Credit approval (offer workflow) stamps ApprovedAt; before that there
        // are no sanctioned terms to record.
        var canRecordSanction = stage != null && stage.ApprovedAt != null
            && stage.Status is nameof(LoanStatus.Approved) or nameof(LoanStatus.Acceptance);
        if (!canRecordSanction)
            return BadRequest(ApiResponseDto<bool>.Fail("Sanction details can only be recorded once the loan has reached the review/approval stage."));

        // Money fields must never be negative (same rule ObligationService
        // applies to EMI/sanction/outstanding) — the API previously stored them.
        if (request.SanctionLoanAmt < 0 || request.SanctionTenureMonths < 0 || request.SanctionRoi < 0 ||
            request.SanctionEmi < 0 || request.Gst < 0 || request.Insurance < 0 || request.PfPercent < 0 || request.FlatRate < 0)
            return BadRequest(ApiResponseDto<bool>.Fail("Sanction amounts, tenure and rates cannot be negative."));

        var detail = await _db.Set<LoanSanctionDetail>().FirstOrDefaultAsync(s => s.LoanId == id);
        if (detail == null)
        {
            detail = new LoanSanctionDetail { LoanId = id, CreatedAt = DateTime.UtcNow };
            _db.Set<LoanSanctionDetail>().Add(detail);
        }
        else
        {
            detail.UpdatedAt = DateTime.UtcNow;
        }

        if (request.SanctionLoanAmt.HasValue) detail.SanctionLoanAmt = request.SanctionLoanAmt.Value;
        if (request.SanctionTenureMonths.HasValue) detail.SanctionTenureMonths = request.SanctionTenureMonths.Value;
        if (request.SanctionRoi.HasValue) detail.SanctionRoi = request.SanctionRoi.Value;
        if (request.SanctionEmi.HasValue) detail.SanctionEmi = request.SanctionEmi.Value;
        if (request.StampDuty != null) detail.StampDuty = request.StampDuty;
        if (request.Gst.HasValue) detail.Gst = request.Gst.Value;
        if (request.Insurance.HasValue) detail.Insurance = request.Insurance.Value;
        if (request.PfPercent.HasValue) detail.PfPercent = request.PfPercent.Value;
        if (request.InsuranceInBundled.HasValue) detail.InsuranceInBundled = request.InsuranceInBundled.Value;
        if (request.PfInBundled.HasValue) detail.PfInBundled = request.PfInBundled.Value;
        if (request.IsBundled.HasValue) detail.IsBundled = request.IsBundled.Value;
        if (request.IsBt.HasValue) detail.IsBt = request.IsBt.Value;
        if (request.FlatRate.HasValue) detail.FlatRate = request.FlatRate.Value;
        if (request.EmiDate.HasValue) detail.EmiDate = request.EmiDate.Value;

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Sanction details saved."));
    }

    /// <summary>
    /// Delete loan (Draft only). Open to any authenticated role — not just
    /// Admin — because this is now also how the wizard's Applications →
    /// Drafts "Discard" button works (see LoansPage.tsx / draftStorage.ts),
    /// and every non-Admin role needs to be able to discard their own
    /// in-progress draft. LoanService.DeleteAsync enforces the actual
    /// authorization (same creator-or-Admin/Manager rule as GetDraft/
    /// ListDrafts in WizardController) and still only ever allows deleting
    /// a Draft-status loan — every other status is rejected regardless of role.
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var result = await _loanService.DeleteAsync(id, CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    /// <summary>
    /// Bulk fetch — same role-based scoping as GetAll.
    /// Page size capped lower for non-admin roles.
    /// </summary>
    [HttpGet("bulk")]
    public async Task<IActionResult> GetBulk([FromQuery] int pageSize = 50)
    {
        // Cap page size based on role — external roles get fewer records per call
        var maxSize = CurrentUserRole is "Admin" or "Manager" ? 200 : 50;
        pageSize = Math.Clamp(pageSize, 1, maxSize);

        var filter = new LoanFilterDto { PageSize = pageSize, Page = 1, SortBy = "CreatedAt", SortDir = "desc" };
        // Role-based scoping is applied inside GetAllAsync (same as the standard list endpoint)
        var result = await _loanService.GetAllAsync(filter, CurrentUserId, CurrentUserRole);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    /// <summary>
    /// Applications → Export. Same filters as the standard list endpoint
    /// (status, loan type, customer, assignee, date range, search) and the
    /// same role-based visibility scope, but returns a CSV file instead of
    /// a paginated JSON page — capped at 5000 rows so a very broad/empty
    /// filter can't pull an unbounded result set into memory.
    /// </summary>
    [HttpGet("export")]
    public async Task<IActionResult> Export([FromQuery] LoanFilterDto filter)
    {
        var rows = await _loanService.ExportAsync(filter, CurrentUserId, CurrentUserRole);

        var sb = new System.Text.StringBuilder();
        sb.AppendLine("Loan Number,Status,Loan Type,Requested Amount,Approved Amount,Interest Rate,Tenure (Months),Customer Name,Customer Phone,Created By,Assigned To,Login User,Created At");
        foreach (var l in rows)
        {
            sb.AppendLine(string.Join(",",
                CsvField(l.LoanNumber), CsvField(l.Status), CsvField(l.LoanType),
                CsvField(l.RequestedAmount), CsvField(l.ApprovedAmount), CsvField(l.InterestRate), CsvField(l.TenureMonths),
                CsvField(l.CustomerName), CsvField(l.CustomerPhone), CsvField(l.CreatedByName),
                CsvField(l.AssignedToName), CsvField(l.LoginUserName), CsvField(l.CreatedAt.ToString("yyyy-MM-dd HH:mm"))));
        }

        var bytes = System.Text.Encoding.UTF8.GetBytes(sb.ToString());
        var fileName = $"applications_export_{DateTime.UtcNow:yyyyMMdd_HHmmss}.csv";
        return File(bytes, "text/csv", fileName);
    }

    /// <summary>Minimal CSV field escaping — wraps in quotes and doubles any
    /// embedded quotes, same convention already used elsewhere in this
    /// codebase for CSV export (e.g. Payout's CSV export in efin-app.js).</summary>
    private static string CsvField(object? value)
    {
        var s = value?.ToString() ?? "";
        return s.Contains(',') || s.Contains('"') || s.Contains('\n')
            ? "\"" + s.Replace("\"", "\"\"") + "\""
            : s;
    }

    /// <summary>
    /// 🟠 Missing Document Detection (item #7) — beyond the 2 hard-mandatory
    /// documents already enforced at wizard Step 8 (salary_slip, bank_statement,
    /// see NewApplicationPage.tsx's computeStepErrors), this checks against
    /// information the wizard itself already collected: if the applicant is
    /// self-employed and reported a GST number / filed ITR, a "gst"/"itr"
    /// document (both already valid DocumentType values — see
    /// UploadDocument's allowedDocTypes whitelist) is expected. This is the
    /// one rule directly inferable from data already in the system; broader
    /// per-lender/per-product document requirements are NOT represented
    /// anywhere in the current schema — REQUIRES BUSINESS CONFIRMATION before
    /// any further rules are added here.
    /// </summary>
    [HttpGet("{id:int}/missing-documents")]
    public async Task<IActionResult> GetMissingDocuments(int id)
    {
        var loan = await _loanService.GetByIdAsync(id, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(loan);

        var customer = await _db.Set<Customer>().FirstOrDefaultAsync(c => c.Id == loan.Data!.Customer.Id);
        var uploadedTypes = await _db.Set<LoanDocument>()
            .Where(d => d.LoanId == id && !d.IsDeleted)
            .Select(d => d.DocumentType)
            .ToListAsync();

        var missing = new List<object>();
        if (!uploadedTypes.Contains("salary_slip"))
            missing.Add(new { type = "salary_slip", reason = "Mandatory for every application (wizard hard requirement)" });
        if (!uploadedTypes.Contains("bank_statement"))
            missing.Add(new { type = "bank_statement", reason = "Mandatory for every application (wizard hard requirement)" });

        // Match the same self-employed semantic the rest of the app uses
        // (frontend isSelfEmployed = /SELF|SENP|BUSIN|PROF/, DeviationEvaluator =
        // "SELFEMP"/"SELF_EMPLOYED"). The wizard stores "SELFEMP"
        // (NewApplicationPage empType map), NOT the literal "Self-Employed" this
        // previously compared against — so ITR/GST were never flagged as missing
        // for ANY self-employed applicant. Case-insensitive substring keeps it
        // robust across the stored variants (SELFEMP / SELF_EMPLOYED / SENP /
        // "Self-Employed" / "Professional" / "Business").
        var et = (customer?.EmploymentType ?? string.Empty).ToUpperInvariant();
        var isSelfEmployed = et.Contains("SELF") || et.Contains("SENP") || et.Contains("BUSIN") || et.Contains("PROF");
        if (isSelfEmployed)
        {
            if (!uploadedTypes.Contains("itr"))
                missing.Add(new { type = "itr", reason = "Expected for self-employed/professional applicants" });
            if (!uploadedTypes.Contains("gst"))
                missing.Add(new { type = "gst", reason = "Expected for self-employed/professional applicants (if GST-registered)" });
        }

        return Ok(ApiResponseDto<object>.Ok(new { loanId = id, missingDocuments = missing, isComplete = missing.Count == 0 }));
    }

    /// <summary>
    /// Wizard pre-check (UX only — the authoritative guard runs again on every
    /// draft save / submit). Runs the SAME global customer identification
    /// (CustomerService.ResolveIdentityAsync) and the SAME duplicate + 45-day
    /// rule (LoanService.CheckApplicationEligibilityAsync) the write paths use,
    /// on normalised PAN / mobile / email. Replaces the legacy "any application
    /// created within 60 days" warning, which contradicted the business rules
    /// (it flagged Closed applications and ignored the rejection date).
    /// loanId = the caller's own draft (excluded from "active application"),
    /// honoured only for a Draft the caller may resume. Never returns another
    /// user's application details to roles that may not see them.
    /// </summary>
    [HttpGet("duplicate-check")]
    public async Task<IActionResult> DuplicateCheck([FromQuery] string? pan, [FromQuery] string? mobile = null,
        [FromQuery] string? email = null, [FromQuery] int? loanId = null)
    {
        if (_customerService == null)
            return Ok(ApiResponseDto<object>.Ok(new { hasDuplicate = false }));

        int? ownLoanId = null, ownCustomerId = null;
        if (loanId is > 0)
        {
            var draft = await _db.Loans.AsNoTracking()
                .Where(l => l.Id == loanId.Value && l.Status == LoanStatus.Draft)
                .Select(l => new { l.Id, l.CustomerId, l.CreatedByUserId }).FirstOrDefaultAsync();
            if (draft != null && (CurrentUserRole is "Admin" or "Manager" || draft.CreatedByUserId == CurrentUserId))
            {
                ownLoanId = draft.Id;
                ownCustomerId = draft.CustomerId;
            }
        }

        var identity = await _customerService.ResolveIdentityAsync(pan, mobile, email, ownCustomerId, ownLoanId);
        if (identity.NeedsReview)
            return Ok(ApiResponseDto<object>.Ok(new
            {
                hasDuplicate = true, code = ApiErrorCodes.CustomerNeedsReview, message = identity.Message
            }));
        if (identity.CustomerId is not int customerId)
            return Ok(ApiResponseDto<object>.Ok(new { hasDuplicate = false }));

        var eligibility = await _loanService.CheckApplicationEligibilityAsync(customerId, ownLoanId);
        if (eligibility.Allowed)
            return Ok(ApiResponseDto<object>.Ok(new { hasDuplicate = false, existingCustomer = true }));

        var detailed = CurrentUserRole is "Admin" or "Manager"
                       || eligibility.BlockingLoanCreatedByUserId == CurrentUserId;
        return Ok(ApiResponseDto<object>.Ok(new
        {
            hasDuplicate = true,
            code         = eligibility.Code,
            message      = LoanMS.Application.Services.LoanService.DescribeEligibilityForCaller(eligibility, CurrentUserId, CurrentUserRole),
            status       = detailed ? eligibility.BlockingStatus : null,
            loanNumber   = detailed ? eligibility.BlockingLoanNumber : null,
            reapplyAfter = eligibility.ReapplyAfterUtc,
        }));
    }

    /// <summary>Calculate EMI before submission — no DB write</summary>
    [HttpGet("calculate-emi")]
    public IActionResult CalculateEmi([FromQuery] decimal amount, [FromQuery] decimal rate, [FromQuery] int tenure)
    {
        if (amount <= 0 || rate <= 0 || tenure <= 0)
            return BadRequest(ApiResponseDto<object>.Fail("Invalid parameters."));

        decimal emi = LoanMS.Application.Services.EmiCalculator.ReducingBalance(amount, rate, tenure);
        decimal totalPayable  = Math.Round(emi, 2) * tenure;
        decimal totalInterest = totalPayable - amount;

        return Ok(ApiResponseDto<object>.Ok(new {
            monthlyEmi    = Math.Round(emi, 2),
            totalPayable  = Math.Round(totalPayable, 2),
            totalInterest = Math.Round(totalInterest, 2),
            principal     = amount,
            ratePercent   = rate,
            tenureMonths  = tenure
        }));
    }

    /// <summary>
    /// Upload document for a loan.
    /// Files are stored outside wwwroot and served only through this authenticated endpoint.
    /// </summary>
    [HttpPost("{id:int}/documents")]
    [RequestSizeLimit(20 * 1024 * 1024)]
    public async Task<IActionResult> UploadDocument(int id, IFormFile file, [FromForm] string? documentType,
        [FromForm] string? applicantRole = null, [FromForm] string? applicantKey = null)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canUploadDocs"))
            return Forbid();

        var loan = await _loanService.GetByIdAsync(id, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(loan);
        if (file == null || file.Length == 0)
            return BadRequest(ApiResponseDto<object>.Fail("No file provided."));

        if (string.IsNullOrWhiteSpace(documentType))
            return BadRequest(ApiResponseDto<object>.Fail("Document type is required."));

        // Materialise into a non-nullable local — compiler flow analysis does not narrow
        // string? to string across IsNullOrWhiteSpace, so we do it explicitly here.
        var docType = documentType.ToLowerInvariant();

        // Validate extension
        var allowedExts = new[] { ".pdf", ".jpg", ".jpeg", ".png", ".xlsx", ".csv" };
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!allowedExts.Contains(ext))
            return BadRequest(ApiResponseDto<object>.Fail($"File type '{ext}' is not allowed."));

        // Validate actual MIME type via magic bytes — prevent extension spoofing
        if (!await IsAllowedMimeTypeAsync(file, ext))
            return BadRequest(ApiResponseDto<object>.Fail("File content does not match its extension."));

        // Validate documentType against whitelist
        var allowedDocTypes = new[] {
            "identity", "address", "income", "bank_statement",
            "salary_slip", "itr", "gst", "property", "other"
        };
        if (!allowedDocTypes.Contains(docType))
            return BadRequest(ApiResponseDto<object>.Fail("Invalid document type."));

        // Store outside wwwroot — never served as static files. Storage key
        // is prefixed "loans/" so this can never collide with a DSA
        // document at the same numeric id in the same bucket/local root —
        // the DB-stored FilePath itself stays exactly "{id}/{fileName}" as
        // before (no schema/data change), the "loans/" prefix is added only
        // at the storage-key level, consistently, on both save and read.
        var fileName = $"{Guid.NewGuid()}{ext}";
        var storageKey = $"loans/{id}/{fileName}";

        await using (var stream = file.OpenReadStream())
            await _fileStorage.SaveAsync(storageKey, stream, file.ContentType);

        // Link the upload to the loan in the database — this is what makes it
        // show up under the loan record (and in GetDocuments below) rather
        // than existing only as an orphaned file in storage.
        // Gap-2: tag the document's applicant identity. Defaults to primary
        // Applicant when not supplied (preserves existing single-applicant behavior).
        var docApplicantRole = string.Equals(applicantRole, "CoApplicant", StringComparison.OrdinalIgnoreCase)
            ? LoanMS.Domain.Enums.ApplicantRole.CoApplicant
            : LoanMS.Domain.Enums.ApplicantRole.Applicant;

        var docRecord = new LoanDocument
        {
            LoanId           = id,
            DocumentName     = Path.GetFileNameWithoutExtension(file.FileName),
            DocumentType     = docType,
            FilePath         = $"{id}/{fileName}",   // opaque ref — no on-disk path
            FileSizeBytes    = file.Length,
            UploadedByUserId = CurrentUserId.ToString(),
            ApplicantRole    = docApplicantRole,
            ApplicantKey     = string.IsNullOrWhiteSpace(applicantKey) ? null : applicantKey.Trim(),
            CreatedAt        = DateTime.UtcNow
        };
        _db.Set<LoanDocument>().Add(docRecord);
        await _db.SaveChangesAsync();

        // Return a reference token — not a raw file path
        return Ok(ApiResponseDto<object>.Ok(new {
            id            = docRecord.Id,
            documentName  = docRecord.DocumentName,
            documentType  = docRecord.DocumentType,
            fileRef       = docRecord.FilePath,
            fileSizeBytes = docRecord.FileSizeBytes,
            uploadedAt    = docRecord.CreatedAt
        }, "Document uploaded successfully."));
    }

    /// <summary>
    /// Download a document — authenticated, ownership-checked.
    /// Replaces the old static-file URL pattern.
    /// </summary>
    [HttpGet("{id:int}/documents/{fileName}")]
    public async Task<IActionResult> DownloadDocument(int id, string fileName)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canViewDocuments"))
            return Forbid();

        // Sanitise filename — reject path traversal attempts
        if (fileName.Contains("..") || fileName.Contains('/') || fileName.Contains('\\'))
            return BadRequest(ApiResponseDto<object>.Fail("Invalid file reference."));

        // Verify caller has access to this loan
        var loan = await _loanService.GetByIdAsync(id, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(ApiResponseDto<object>.Fail("Loan not found."));

        var storageKey = $"loans/{id}/{fileName}";
        var result = await _fileStorage.GetAsync(storageKey);
        if (result == null)
            return NotFound(ApiResponseDto<object>.Fail("Document not found."));

        var (content, storedContentType) = result.Value;

        // Serve with correct Content-Type — prefer whatever the storage
        // backend recorded at upload time (S3), fall back to sniffing the
        // extension (local disk never stored a content type).
        var contentType = storedContentType;
        if (string.IsNullOrWhiteSpace(contentType))
        {
            var provider = new FileExtensionContentTypeProvider();
            if (!provider.TryGetContentType(fileName, out contentType!))
                contentType = "application/octet-stream";
        }

        using var ms = new MemoryStream();
        await content.CopyToAsync(ms);
        content.Dispose();
        return File(ms.ToArray(), contentType, fileName);
    }

    /// <summary>List documents for a loan, sourced from the database (name, type, uploader).</summary>
    [HttpGet("{id:int}/documents")]
    public async Task<IActionResult> GetDocuments(int id)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canViewDocuments"))
            return Forbid();

        var loan = await _loanService.GetByIdAsync(id, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(loan);

        var docs = await _db.Set<LoanDocument>()
            .Where(d => d.LoanId == id && !d.IsDeleted)
            .OrderByDescending(d => d.CreatedAt)
            .Select(d => new {
                id            = d.Id,
                documentName  = d.DocumentName,
                documentType  = d.DocumentType,
                fileRef       = d.FilePath,
                fileSizeBytes = d.FileSizeBytes,
                uploadedAt    = d.CreatedAt,
                // Wizard-to-detail-page linking fix: ApplicantRole/ApplicantKey
                // were already being saved on upload (see UploadDocument above)
                // but never selected here, so the Documents tab had no way to
                // tell a primary applicant's document apart from an identically-
                // typed co-applicant one (e.g. Education loan's co-applicant
                // salary slips / bank statement).
                applicantRole    = d.ApplicantRole.ToString(),
                applicantKey     = d.ApplicantKey,
                // Phase 2 RBAC — G-10/G-11 verification + versioning surface.
                status           = d.Status,
                reviewNote       = d.ReviewNote,
                reviewedByUserId = d.ReviewedByUserId,
                reviewedAt       = d.ReviewedAt,
                version          = d.Version
            })
            .ToListAsync();

        return Ok(ApiResponseDto<object>.Ok(docs));
    }

    /// <summary>
    /// Delete an uploaded document (soft delete). Was missing entirely —
    /// the frontend's deleteWizDoc() only ever removed the document from
    /// local state, so it reappeared the next time GetDocuments/GetById
    /// was called from any device. Same access rule as the other document
    /// endpoints: the caller must have visibility on the parent loan.
    /// </summary>
    [HttpDelete("{id:int}/documents/{documentId:int}")]
    public async Task<IActionResult> DeleteDocument(int id, int documentId)
    {
        // Deleting a document is a document-MANAGEMENT action, gated by the
        // same canUploadDocs permission as upload (and as the frontend's own
        // delete button). Previously this endpoint had NO permission check at
        // all -- only the class-level [Authorize] + visibility -- so any
        // authenticated user who could see the loan could delete its
        // documents by calling the route directly, even with canUploadDocs
        // off. Frontend gate and backend now agree.
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canUploadDocs"))
            return Forbid();

        var loan = await _loanService.GetByIdAsync(id, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(loan);

        var doc = await _db.Set<LoanDocument>().FirstOrDefaultAsync(d => d.Id == documentId && d.LoanId == id && !d.IsDeleted);
        if (doc == null) return NotFound(ApiResponseDto<bool>.Fail("Document not found."));

        doc.IsDeleted = true;
        doc.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Purge the stored bytes too, so a deleted KYC/financial document
        // doesn't linger in the bucket forever (and to reclaim storage). The
        // DB soft-delete above has already committed and is the source of
        // truth, so this is best-effort: a storage hiccup must not turn a
        // successful deletion into a 500. The storage key mirrors the upload
        // side exactly — "loans/" + the opaque FilePath ("{id}/{fileName}").
        try
        {
            await _fileStorage.DeleteAsync(DocumentStorageKeys.ForLoanDocument(doc.FilePath));
        }
        catch
        {
            // Swallowed intentionally — the row is already flagged deleted;
            // a leftover object is a storage-cost issue, not a correctness
            // one, and re-throwing would wrongly report the delete as failed.
        }

        return Ok(ApiResponseDto<bool>.Ok(true, "Document deleted."));
    }

    // ── Phase 2 RBAC — G-10 / G-11 document verification & replace ─────────────

    /// <summary>
    /// Verify a document (Status → "Verified"). Gated by BOTH a fixed role list
    /// (the internal processing roles that also change loan status) AND the
    /// fine-grained, Admin-configurable canVerifyDocs permission — verification
    /// is a review action, distinct from upload (canUploadDocs). Scope is
    /// enforced the same way as every other document endpoint: the caller must
    /// have visibility on the parent loan (GetByIdAsync → 404 otherwise), so a
    /// direct API call cannot verify a document on a loan outside the caller's
    /// scope.
    /// </summary>
    [HttpPatch("{id:int}/documents/{documentId:int}/verify")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager")]
    public async Task<IActionResult> VerifyDocument(int id, int documentId, [FromBody] DocumentReviewRequestDto? request)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canVerifyDocs"))
            return Forbid();

        var loan = await _loanService.GetByIdAsync(id, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(loan);

        var doc = await _db.Set<LoanDocument>().FirstOrDefaultAsync(d => d.Id == documentId && d.LoanId == id && !d.IsDeleted);
        if (doc == null) return NotFound(ApiResponseDto<bool>.Fail("Document not found."));

        var oldStatus = doc.Status;
        doc.Status           = "Verified";
        doc.ReviewNote       = request?.Note;
        doc.ReviewedByUserId = CurrentUserId.ToString();
        doc.ReviewedAt       = DateTime.UtcNow;
        doc.UpdatedAt        = DateTime.UtcNow;

        AuditHelper.LogChange(_db, HttpContext, "LoanDocument", documentId.ToString(), "DocumentVerified",
            oldValues: oldStatus, newValues: "Verified", reason: request?.Note,
            userId: CurrentUserId, userName: CurrentUserEmail);

        await _db.SaveChangesAsync();

        return Ok(ApiResponseDto<bool>.Ok(true, "Document verified."));
    }

    /// <summary>
    /// Reject a document (Status → "Rejected"). Same gate as Verify. A rejection
    /// reason is MANDATORY — recorded in ReviewNote with the reviewer + time,
    /// satisfying the structured-reason requirement (G-23) for this action.
    /// </summary>
    [HttpPatch("{id:int}/documents/{documentId:int}/reject")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager")]
    public async Task<IActionResult> RejectDocument(int id, int documentId, [FromBody] DocumentReviewRequestDto request)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canVerifyDocs"))
            return Forbid();

        if (request == null || string.IsNullOrWhiteSpace(request.Note))
            return BadRequest(ApiResponseDto<bool>.Fail("A rejection reason is required."));

        var loan = await _loanService.GetByIdAsync(id, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(loan);

        var doc = await _db.Set<LoanDocument>().FirstOrDefaultAsync(d => d.Id == documentId && d.LoanId == id && !d.IsDeleted);
        if (doc == null) return NotFound(ApiResponseDto<bool>.Fail("Document not found."));

        var oldStatus = doc.Status;
        doc.Status           = "Rejected";
        doc.ReviewNote       = request.Note;
        doc.ReviewedByUserId = CurrentUserId.ToString();
        doc.ReviewedAt       = DateTime.UtcNow;
        doc.UpdatedAt        = DateTime.UtcNow;

        AuditHelper.LogChange(_db, HttpContext, "LoanDocument", documentId.ToString(), "DocumentRejected",
            oldValues: oldStatus, newValues: "Rejected", reason: request.Note,
            userId: CurrentUserId, userName: CurrentUserEmail);

        await _db.SaveChangesAsync();

        return Ok(ApiResponseDto<bool>.Ok(true, "Document rejected."));
    }

    /// <summary>
    /// Replace a document with a new file, preserving history. The old document
    /// row is soft-deleted and linked (SupersededByDocumentId) to a NEW row
    /// whose Version is the old Version + 1 and whose Status resets to
    /// "Pending" (a fresh file must be re-reviewed). Same document-management
    /// permission as upload/delete (canUploadDocs) plus the same visibility
    /// check on the parent loan — no new authorization path. Same file
    /// validation (extension + magic-byte MIME + size) as upload.
    /// </summary>
    [HttpPost("{id:int}/documents/{documentId:int}/replace")]
    [RequestSizeLimit(20 * 1024 * 1024)]
    public async Task<IActionResult> ReplaceDocument(int id, int documentId, IFormFile file)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canUploadDocs"))
            return Forbid();

        var loan = await _loanService.GetByIdAsync(id, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(loan);

        var oldDoc = await _db.Set<LoanDocument>().FirstOrDefaultAsync(d => d.Id == documentId && d.LoanId == id && !d.IsDeleted);
        if (oldDoc == null) return NotFound(ApiResponseDto<bool>.Fail("Document not found."));

        if (file == null || file.Length == 0)
            return BadRequest(ApiResponseDto<object>.Fail("No file provided."));

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        var allowedExts = new[] { ".pdf", ".jpg", ".jpeg", ".png", ".xlsx", ".csv" };
        if (!allowedExts.Contains(ext))
            return BadRequest(ApiResponseDto<object>.Fail($"File type '{ext}' is not allowed."));
        if (!await IsAllowedMimeTypeAsync(file, ext))
            return BadRequest(ApiResponseDto<object>.Fail("File content does not match its extension."));

        // Store the replacement under a fresh opaque key (never overwrite the
        // old object — the superseded version stays independently addressable).
        var fileName   = $"{Guid.NewGuid()}{ext}";
        var storageKey = $"loans/{id}/{fileName}";
        await using (var stream = file.OpenReadStream())
            await _fileStorage.SaveAsync(storageKey, stream, file.ContentType);

        var newDoc = new LoanDocument
        {
            LoanId           = id,
            DocumentName     = Path.GetFileNameWithoutExtension(file.FileName),
            DocumentType     = oldDoc.DocumentType,   // carry the classification forward
            // Gap-2 applicant identity must survive a replace — otherwise a
            // replaced co-applicant document silently became the PRIMARY
            // applicant's (role defaulted to Applicant, key dropped) and
            // income verification picked it up for the wrong person.
            ApplicantRole    = oldDoc.ApplicantRole,
            ApplicantKey     = oldDoc.ApplicantKey,
            FilePath         = $"{id}/{fileName}",
            FileSizeBytes    = file.Length,
            UploadedByUserId = CurrentUserId.ToString(),
            Status           = "Pending",             // a new file must be re-reviewed
            Version          = oldDoc.Version + 1,
            CreatedAt        = DateTime.UtcNow
        };
        _db.Set<LoanDocument>().Add(newDoc);
        await _db.SaveChangesAsync();   // materialise newDoc.Id for the link below

        oldDoc.IsDeleted              = true;
        oldDoc.SupersededByDocumentId = newDoc.Id;
        oldDoc.UpdatedAt              = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(ApiResponseDto<object>.Ok(new {
            id            = newDoc.Id,
            documentName  = newDoc.DocumentName,
            documentType  = newDoc.DocumentType,
            fileRef       = newDoc.FilePath,
            fileSizeBytes = newDoc.FileSizeBytes,
            version       = newDoc.Version,
            replacedId    = documentId
        }, "Document replaced."));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>Validate file magic bytes against allowed extensions.</summary>
    private static async Task<bool> IsAllowedMimeTypeAsync(IFormFile file, string ext)
    {
        var headerBytes = new byte[8];
        await using var stream = file.OpenReadStream();
        var read = await stream.ReadAsync(headerBytes.AsMemory(0, 8));
        if (read < 4) return false;

        return ext switch
        {
            ".pdf"  => headerBytes[0] == 0x25 && headerBytes[1] == 0x50 &&
                       headerBytes[2] == 0x44 && headerBytes[3] == 0x46, // %PDF
            ".jpg"  => headerBytes[0] == 0xFF && headerBytes[1] == 0xD8, // JFIF/EXIF
            ".jpeg" => headerBytes[0] == 0xFF && headerBytes[1] == 0xD8,
            ".png"  => headerBytes[0] == 0x89 && headerBytes[1] == 0x50 &&
                       headerBytes[2] == 0x4E && headerBytes[3] == 0x47, // PNG
            ".xlsx" => headerBytes[0] == 0x50 && headerBytes[1] == 0x4B, // PK (ZIP)
            ".csv"  => true, // CSV is plain text — no reliable magic bytes; extension check is sufficient
            _       => false
        };
    }
}

public class RejectRequestDto
{
    public string? Reason { get; set; }
}

public class HoldRequestDto
{
    public string? Reason { get; set; }
}

/// <summary>Body for document verify/reject. Note is optional on verify,
/// mandatory (the rejection reason) on reject.</summary>
public class DocumentReviewRequestDto
{
    public string? Note { get; set; }
}

/// <summary>Body for the Admin stage-override endpoint. Reason is mandatory.</summary>
public class OverrideStatusRequestDto
{
    public LoanStatus NewStatus { get; set; }
    public string? Reason { get; set; }
}

public class ReopenRequestDto
{
    public string? Reason { get; set; }
}
