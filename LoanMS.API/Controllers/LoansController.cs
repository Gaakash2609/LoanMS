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

    public LoansController(ILoanService loanService, AppDbContext db, LoanMS.Application.Interfaces.IFileStorageService fileStorage, LoanMS.API.Services.IRolePermissionService rolePerm)
    {
        _loanService = loanService;
        _db          = db;
        _fileStorage = fileStorage;
        _rolePerm    = rolePerm;
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

    // ═══════════════════════════════════════════════════════════════════
    // TEMPORARY DEBUG ENDPOINT — remove after the Tab Data Access masking
    // issue is diagnosed. Not gated behind [Authorize(Roles="Admin")] on
    // purpose: it must be hit by the SAME session/role that is seeing the
    // bug (e.g. Sales), so it needs to run under that role's own token.
    // Returns, in one response:
    //   1. backendRole   — exactly what CurrentUserRole resolves to for
    //                       this session (the JWT claim value)
    //   2. roleKey       — the frontend-vocabulary key RolePermissionService
    //                       maps backendRole to (duplicated here from
    //                       RolePermissionService.RoleKeyMap — keep in sync;
    //                       this whole block is deleted once done anyway)
    //   3. rawSettingValue — the exact "efin_role_permissions" JSON string
    //                       currently in AppSettings (UserId == null row),
    //                       or null if no such row exists
    //   4. roleObjectFoundInJson — whether rawSettingValue actually has a
    //                       top-level property matching roleKey
    //   5. deniedTabs    — the live output of GetDeniedPermissionsAsync for
    //                       this role, for the same 4 keys GetById checks
    // ═══════════════════════════════════════════════════════════════════
    [HttpGet("{id:int}/debug-permissions")]
    public async Task<IActionResult> DebugPermissions(int id)
    {
        var backendRole = CurrentUserRole;

        // Exact copy of RolePermissionService.RoleKeyMap — DO NOT let this
        // drift from that file while this debug endpoint is in use.
        var roleKeyMap = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Admin"] = "admin", ["Manager"] = "manager", ["Sales"] = "sales_executive",
            ["Dsa"] = "dsa_user", ["Partner"] = "partner", ["LoginTeam"] = "login_team",
            ["TeamLeader"] = "team_leader", ["Accounts"] = "accounts",
            ["LocationHead"] = "location_head", ["OperationManager"] = "operation_manager",
            ["ProductTeam"] = "product_team",
        };
        roleKeyMap.TryGetValue(backendRole ?? string.Empty, out var roleKey);

        var setting = await _db.AppSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Key == "efin_role_permissions" && s.UserId == null);

        bool? roleObjectFoundInJson = null;
        System.Text.Json.JsonElement? roleObjectRaw = null;
        if (setting != null && !string.IsNullOrWhiteSpace(setting.Value) && roleKey != null)
        {
            try
            {
                using var doc = System.Text.Json.JsonDocument.Parse(setting.Value);
                roleObjectFoundInJson = doc.RootElement.TryGetProperty(roleKey, out var roleObj);
                if (roleObjectFoundInJson == true)
                    roleObjectRaw = System.Text.Json.JsonDocument.Parse(roleObj.GetRawText()).RootElement;
            }
            catch (Exception ex)
            {
                roleObjectFoundInJson = false;
                roleObjectRaw = null;
                return Ok(new
                {
                    backendRole,
                    roleKey,
                    rawSettingValue = setting.Value,
                    jsonParseError = ex.Message
                });
            }
        }

        var deniedTabs = await _rolePerm.GetDeniedPermissionsAsync(backendRole,
            new[] { "canViewPersonal", "canViewAddress", "canViewEmployment", "canViewReferences" });

        return Ok(new
        {
            backendRole,
            roleKey,
            settingRowExists = setting != null,
            settingRowUserId = setting?.UserId,
            rawSettingValue = setting?.Value,
            roleObjectFoundInJson,
            roleObjectRaw,
            deniedTabs
        });
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

        var result = await _loanService.CreateAsync(request, CurrentUserId);
        if (!result.Success) return BadRequest(result);
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
        if (!result.Success) return ApiResult(result);

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
        if (!result.Success) return ApiResult(result);

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

    /// <summary>Approve loan [Roles with canChangeStatus:true — approval is a status transition]</summary>
    [HttpPatch("{id:int}/approve")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager")]
    public async Task<IActionResult> Approve(int id, [FromBody] ApproveRequestDto request)
    {
        // Same fine-grained check UpdateStatus (PATCH .../status) already
        // applies for this exact transition -- added here because the UI now
        // calls this dedicated route directly (see loansApi.ts), so without
        // this the Settings screen's per-role canChangeStatus toggle stopped
        // actually governing the button it's meant to control.
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canChangeStatus"))
            return Forbid();

        var result = await _loanService.UpdateStatusAsync(id,
            new UpdateLoanStatusRequestDto
            {
                NewStatus      = LoanStatus.Approved,
                ApprovedAmount = request.ApprovedAmount,
                Comment        = request.Comment ?? "Loan approved."
            },
            CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

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

    /// <summary>Disburse loan [Roles with canDisburse:true in the frontend ROLES matrix]</summary>
    [HttpPatch("{id:int}/disburse")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager")]
    public async Task<IActionResult> Disburse(int id)
    {
        // Same reasoning as Approve above -- matches UpdateStatus's own
        // canDisburse check for this transition.
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canDisburse"))
            return Forbid();

        var result = await _loanService.UpdateStatusAsync(id,
            new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Disbursed, Comment = "Loan disbursed." },
            CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

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

    /// <summary>
    /// Policy-band deviation flags for this loan (empty = within policy),
    /// gated on canDeviation — the permission that previously governed
    /// nothing. Ported from legacy laCheckDeviations: ROI band vs CIBIL,
    /// FOIR cap, loan-amount income multiplier, tenure max, CIBIL minimum.
    /// Read-only risk signal for reviewers; does not change loan state.
    /// </summary>
    [HttpGet("{id:int}/deviations")]
    public async Task<IActionResult> GetDeviations(int id)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canDeviation"))
            return Forbid();

        var result = await _loanService.GetDeviationsAsync(id, CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    /// <summary>
    /// Raise a policy deviation on an Under Review loan → Decision
    /// [canDeviation]. Type + reason required. Legacy: confirmDeviation.
    /// </summary>
    [HttpPatch("{id:int}/deviation/raise")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager")]
    public async Task<IActionResult> RaiseDeviation(int id, [FromBody] RaiseDeviationRequestDto request)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canDeviation"))
            return Forbid();

        var result = await _loanService.RaiseDeviationAsync(id, request?.DeviationType ?? "", request?.Reason ?? "", CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    /// <summary>
    /// Decide a raised deviation (approve → Approved, else → Rejected)
    /// [canDeviation]. The raiser cannot approve their own deviation unless
    /// Admin (enforced in the service). Legacy: confirmApprovedDeviation.
    /// </summary>
    [HttpPatch("{id:int}/deviation/decide")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager")]
    public async Task<IActionResult> DecideDeviation(int id, [FromBody] DecideDeviationRequestDto request)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canDeviation"))
            return Forbid();

        var result = await _loanService.DecideDeviationAsync(id, request?.Approve ?? false, request?.Comment, CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

    /// <summary>
    /// Skip deviation routing on an Under Review loan → Approved
    /// [canDeviation]. Legacy: confirmSkipDeviation.
    /// </summary>
    [HttpPatch("{id:int}/deviation/skip")]
    [Authorize(Roles = "Admin,Manager,LoginTeam,TeamLeader,LocationHead,OperationManager")]
    public async Task<IActionResult> SkipDeviation(int id, [FromBody] HoldRequestDto? request)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canDeviation"))
            return Forbid();

        var result = await _loanService.SkipDeviationAsync(id, request?.Reason, CurrentUserId, CurrentUserRole);
        return ApiResult(result);
    }

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
    [HttpPut("{id:int}/sanction-detail")]
    [Authorize(Roles = "Admin,Manager,Sales,Partner,Dsa,LoginTeam,TeamLeader,LocationHead,OperationManager,Accounts,ProductTeam")]
    public async Task<IActionResult> UpdateSanctionDetail(int id, [FromBody] UpdateLoanSanctionDetailRequestDto request)
    {
        var loan = await _loanService.GetByIdAsync(id, CurrentUserId, CurrentUserRole);
        if (!loan.Success) return NotFound(loan);

        // Stage guard — sanction terms are recorded only once the loan is at/after the
        // approval step (legacy: the "Approve with Details" step is the only writer of
        // sanction data). UnderReview is allowed because the Approve-with-Details modal
        // saves the terms just before it moves the loan to Approved; Decision covers the
        // deviation-approval path. Anything earlier (Draft/Submitted, never approved)
        // is rejected so a sanction row can't exist for a loan at its initial stage.
        var stage = loan.Data;
        var canRecordSanction = stage != null && (stage.ApprovedAt != null
            || stage.Status == nameof(LoanStatus.UnderReview)
            || stage.Status == nameof(LoanStatus.Decision));
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
    /// Duplicate-application check (productivity audit, P1 — the exact rule
    /// already established client-side in efin-app.js's wPanCheck(): same
    /// PAN, any non-Draft status, created within the last 60 days). That
    /// existing check only ever looked at APPLICATIONS — this browser's
    /// locally-synced (capped/paginated) copy — so it could miss a genuine
    /// recent duplicate that simply hadn't synced to this particular
    /// browser yet. This is the same rule, made authoritative against the
    /// full database. Warning-only (matches existing UX) — does not block
    /// anything, just surfaces the same "recent application on this PAN"
    /// signal the wizard already shows, reliably this time.
    /// </summary>
    [HttpGet("duplicate-check")]
    public async Task<IActionResult> DuplicateCheck([FromQuery] string pan)
    {
        if (string.IsNullOrWhiteSpace(pan) || pan.Trim().Length != 10)
            return Ok(ApiResponseDto<object>.Ok(new { hasDuplicate = false }));

        var cutoff = DateTime.UtcNow.AddDays(-60);
        var match = await _db.Loans
            .Where(l => l.Status != LoanStatus.Draft && l.CreatedAt >= cutoff)
            .Include(l => l.Customer)
            .Where(l => l.Customer.PanNumber == pan.Trim().ToUpper())
            .OrderByDescending(l => l.CreatedAt)
            .Select(l => new { l.LoanNumber, Status = l.Status.ToString(), l.Customer.FullName, l.CreatedAt })
            .FirstOrDefaultAsync();

        if (match == null)
            return Ok(ApiResponseDto<object>.Ok(new { hasDuplicate = false }));

        return Ok(ApiResponseDto<object>.Ok(new
        {
            hasDuplicate = true,
            loanNumber = match.LoanNumber,
            status = match.Status,
            customerName = match.FullName,
            daysAgo = Math.Round((DateTime.UtcNow - match.CreatedAt).TotalDays, 1)
        }));
    }

    /// <summary>Calculate EMI before submission — no DB write</summary>
    [HttpGet("calculate-emi")]
    public IActionResult CalculateEmi([FromQuery] decimal amount, [FromQuery] decimal rate, [FromQuery] int tenure)
    {
        if (amount <= 0 || rate <= 0 || tenure <= 0)
            return BadRequest(ApiResponseDto<object>.Fail("Invalid parameters."));

        decimal r   = rate / 12 / 100;
        decimal emi = amount * r * (decimal)Math.Pow((double)(1 + r), tenure)
                      / ((decimal)Math.Pow((double)(1 + r), tenure) - 1);
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

public class ApproveRequestDto
{
    public decimal? ApprovedAmount { get; set; }
    public string?  Comment        { get; set; }
}

public class RejectRequestDto
{
    public string? Reason { get; set; }
}

public class HoldRequestDto
{
    public string? Reason { get; set; }
}

public class RaiseDeviationRequestDto
{
    public string? DeviationType { get; set; }
    public string? Reason { get; set; }
}

public class DecideDeviationRequestDto
{
    public bool Approve { get; set; }
    public string? Comment { get; set; }
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
