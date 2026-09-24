using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;

namespace LoanMS.Application.Services;

public class LoanService : ILoanService
{
    private readonly IUnitOfWork   _uow;
    private readonly ICacheService _cache;
    private readonly IEmailService _emailService;
    private readonly IEmailTemplateProvider _emailTemplates;
    // Phase 7 (locked rule): authoritative trusted-income resolver. Optional so
    // existing constructions/tests still compile; DI injects the real service.
    private readonly IIncomeVerificationService? _incomeVerification;

    public LoanService(IUnitOfWork uow, ICacheService cache, IEmailService emailService,
        IEmailTemplateProvider emailTemplates, IIncomeVerificationService? incomeVerification = null)
    {
        _uow   = uow;
        _cache = cache;
        _emailService = emailService;
        _emailTemplates = emailTemplates;
        _incomeVerification = incomeVerification;
    }

    // Salaried = NOT self-employed. Mirrors frontend foir.ts isSelfEmployed
    // (/SELF|SENP|BUSIN|PROF/) so the salaried/self-employed split is identical
    // on both sides. Self-employed income is untouched (keeps Perfios-ABB FOIR).
    private static bool IsSalaried(string? employmentType)
    {
        var t = (employmentType ?? string.Empty).ToUpperInvariant();
        var selfEmp = t.Contains("SELF") || t.Contains("SENP") || t.Contains("BUSIN") || t.Contains("PROF");
        return !selfEmp;
    }

    // Roles that may see internal routing data (Remarks field contains lender/channel/source).
    private static readonly HashSet<string> _internalRoles =
        new(StringComparer.OrdinalIgnoreCase) { "Admin", "Manager" };

    // Roles that receive unmasked PII inside embedded CustomerDto.
    private static readonly HashSet<string> _elevatedRoles =
        new(StringComparer.OrdinalIgnoreCase) { "Admin", "Manager" };

    public async Task<ApiResponseDto<LoanDto>> GetByIdAsync(int id, int currentUserId, string callerRole = "Sales", HashSet<string>? deniedTabs = null)
    {
        // Phase 2B — role-based visibility is enforced at the repository query
        // level, not after the fact. If the loan exists but falls outside the
        // caller's scope (e.g. someone swaps the loanId in the URL), this comes
        // back null the same way a genuinely missing loan would — no distinction
        // is leaked between "doesn't exist" and "not yours to see".
        var loan = await _uow.Loans.GetWithDetailsAsync(id, currentUserId, callerRole);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");
        var dto = MapToDto(loan, callerRole, deniedTabs);
        dto.RiskGrade = await _uow.Loans.GetLatestRiskGradeAsync(loan.CustomerId);
        return ApiResponseDto<LoanDto>.Ok(dto);
    }

    public async Task<ApiResponseDto<LoanFilterOptionsDto>> GetFilterOptionsAsync(int userId, string role) =>
        ApiResponseDto<LoanFilterOptionsDto>.Ok(await _uow.Loans.GetFilterOptionsAsync(userId, role));

    public async Task<ApiResponseDto<PagedResultDto<LoanListDto>>> GetAllAsync(LoanFilterDto filter, int currentUserId, string currentUserRole)
    {
        // Phase 1 fix: the Application List must always reflect the current
        // database state, so this always reads straight through to
        // GetPagedAsync — no response cache in front of it. (The previous
        // per-user/role cache key relied on ICacheService.RemoveByPrefixAsync
        // for invalidation, which is a no-op on the Redis-backed
        // DistributedCacheService, so newly created/updated loans could stay
        // hidden from the list for up to the old 30s TTL.)
        // Role-based visibility (ApplyVisibilityScope) is applied inside
        // GetPagedAsync exactly as before — this change only removes caching,
        // not authorization.
        var result = await _uow.Loans.GetPagedAsync(filter, currentUserId, currentUserRole);
        return ApiResponseDto<PagedResultDto<LoanListDto>>.Ok(result);
    }

    public async Task<List<LoanListDto>> ExportAsync(LoanFilterDto filter, int currentUserId, string currentUserRole)
        => await _uow.Loans.GetForExportAsync(filter, currentUserId, currentUserRole);

    public async Task<ApiResponseDto<LoanDto>> CreateAsync(CreateLoanRequestDto request, int createdByUserId)
    {
        var customer = await _uow.Customers.GetByIdAsync(request.CustomerId);
        if (customer == null) return ApiResponseDto<LoanDto>.Fail("Customer not found.");

        var assigneeError = await ValidateAssigneeAsync(request.AssignedToUserId);
        if (assigneeError != null) return ApiResponseDto<LoanDto>.Fail(assigneeError);

        // Login Team assignee — same exists+active validation, reused via
        // ValidateAssigneeAsync (it's generic: works for any user-id field).
        var loginUserError = await ValidateAssigneeAsync(request.LoginUserId);
        if (loginUserError != null) return ApiResponseDto<LoanDto>.Fail(loginUserError);

        var loanNumber = await _uow.Loans.GenerateLoanNumberAsync();
        var emi        = CalculateEmi(request.RequestedAmount, request.InterestRate, request.TenureMonths);

        var loan = new Loan
        {
            LoanNumber       = loanNumber,
            LoanType         = request.LoanType,
            Status           = LoanStatus.Draft,
            RequestedAmount  = request.RequestedAmount,
            InterestRate     = request.InterestRate,
            TenureMonths     = request.TenureMonths,
            MonthlyEmi       = emi,
            Purpose          = request.Purpose,
            Remarks          = request.Remarks,
            CustomerId       = request.CustomerId,
            CreatedByUserId  = createdByUserId,
            AssignedToUserId = request.AssignedToUserId,
            LoginUserId      = request.LoginUserId
        };

        await _uow.Loans.AddAsync(loan);

        // BUGFIX (confirmed at runtime — POST /api/loans returned 500
        // "SQLite Error 19: FOREIGN KEY constraint failed"): this used to set
        // LoanId = loan.Id, but AddAsync only starts tracking the entity
        // (GenericRepository.cs:28-32 — no SaveChanges), so loan.Id was still
        // 0 at this point. The history row was therefore inserted with
        // LoanId = 0, which no Loans row can satisfy.
        //
        // Setting the Loan navigation property instead lets EF Core fill
        // LoanId in from the generated identity during SaveChangesAsync
        // below. Deliberately preferred over inserting an extra
        // SaveChangesAsync() after AddAsync(loan): both rows still go in one
        // SaveChanges — i.e. one transaction — so a failure can never leave a
        // loan persisted without its creation-history row.
        await _uow.LoanStatusHistories.AddAsync(new LoanStatusHistory
        {
            Loan             = loan,
            FromStatus       = LoanStatus.Draft,
            ToStatus         = LoanStatus.Draft,
            Comment          = "Loan application created.",
            ChangedByUserId  = createdByUserId
        });

        await _uow.SaveChangesAsync();
        // Phase 3 — no cache invalidation needed here: GetAllAsync and
        // GetDashboardStatsAsync both read straight through to the database
        // now (no "loans:list:" or "dashboard:" cache exists to invalidate).

        var created = await _uow.Loans.GetWithDetailsAsync(loan.Id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(created!, "Admin"), "Loan created successfully.");
    }

    public async Task<ApiResponseDto<LoanDto>> UpdateAsync(int id, UpdateLoanRequestDto request, int currentUserId, string currentUserRole)
    {
        // Phase 3A — verify the caller can act on this loan BEFORE touching it.
        // Same rule set as read visibility (Phase 2B): reused via HasAccessAsync,
        // not re-implemented here. "Not found" (not "forbidden") is returned for
        // an out-of-scope loan too, so a loanId swap doesn't confirm existence.
        if (!await _uow.Loans.HasAccessAsync(id, currentUserId, currentUserRole))
            return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        if (loan.Status != LoanStatus.Draft && loan.Status != LoanStatus.Submitted)
            return ApiResponseDto<LoanDto>.Fail("Only Draft or Submitted loans can be updated.");

        // Phase 4 (Loan Assignee Validation) — same check as CreateAsync
        // (existence + active), reused via ValidateAssigneeAsync so Update
        // can no longer set AssignedToUserId to a deleted/inactive/nonexistent user.
        var assigneeError = await ValidateAssigneeAsync(request.AssignedToUserId);
        if (assigneeError != null) return ApiResponseDto<LoanDto>.Fail(assigneeError);

        var loginUserError = await ValidateAssigneeAsync(request.LoginUserId);
        if (loginUserError != null) return ApiResponseDto<LoanDto>.Fail(loginUserError);

        loan.LoanType         = request.LoanType;
        loan.RequestedAmount  = request.RequestedAmount;
        loan.InterestRate     = request.InterestRate;
        loan.TenureMonths     = request.TenureMonths;
        loan.MonthlyEmi       = CalculateEmi(request.RequestedAmount, request.InterestRate, request.TenureMonths);
        loan.Purpose          = request.Purpose;
        loan.Remarks          = request.Remarks;
        loan.AssignedToUserId = request.AssignedToUserId;
        loan.LoginUserId      = request.LoginUserId;
        loan.UpdatedAt        = DateTime.UtcNow;

        await _uow.Loans.UpdateAsync(loan);
        await _uow.SaveChangesAsync();
        // No list cache to invalidate — see CreateAsync comment above.

        var updated = await _uow.Loans.GetWithDetailsAsync(id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"), "Loan updated.");
    }

    public async Task<ApiResponseDto<LoanDto>> UpdateStatusAsync(int id, UpdateLoanStatusRequestDto request, int changedByUserId, string changedByUserRole)
    {
        // Phase 3A — same access check before Submit/Approve/Reject/Disburse/Close
        // transitions. For Manager this also enforces the existing location
        // restriction (ApplyVisibilityScope scopes Manager to their Team's
        // Location) — a Manager can no longer approve/reject a loan outside
        // their authorized location just because the Role attribute let them
        // reach the endpoint.
        if (!await _uow.Loans.HasAccessAsync(id, changedByUserId, changedByUserRole))
            return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        var allowed = GetAllowedTransitions(loan.Status);
        if (!allowed.Contains(request.NewStatus))
            return ApiResponseDto<LoanDto>.Fail($"Cannot move from {loan.Status} to {request.NewStatus}.");

        // A zero/negative sanctioned amount was accepted and stored (with a
        // negative EMI) — reject it before any state changes.
        if (request.NewStatus == LoanStatus.Approved && request.ApprovedAmount is <= 0)
            return ApiResponseDto<LoanDto>.Fail("Approved amount must be greater than 0.");

        // ── Underwriting-entry gate (Vanilla doUnderwriting/_hasCompleteBankDetails,
        // efin-app.js) — a loan cannot move into Under Review until at least one
        // Bank Details line (Bank Name + Application Number + Approved Loan) is
        // filled in. NOTE: Vanilla's second prerequisite, "_hasObligationsCalculated"
        // (an app.foirState.foir value must exist), is NOT enforced here — in this
        // architecture FOIR is always a live client-side computation on the Loan
        // Detail page (FoirEligibilityPanel), not a discrete stored action, so
        // there is nothing to gate on; flagging this rather than inventing a
        // stand-in flag for it.
        if (request.NewStatus == LoanStatus.UnderReview)
        {
            var withLines = await _uow.Loans.GetWithDetailsAsync(id);
            var hasCompleteBankLine = withLines?.BankLines != null && withLines.BankLines.Any(b =>
                !string.IsNullOrWhiteSpace(b.BankName) &&
                !string.IsNullOrWhiteSpace(b.ApplicationNumber) &&
                b.ApprovedLoan.HasValue && b.ApprovedLoan.Value > 0);
            if (!hasCompleteBankLine)
                return ApiResponseDto<LoanDto>.Fail(
                    "Cannot move to Under Review — add at least one complete Bank Details line "
                    + "(Bank Name, Application Number, Approved Loan) first.");
        }

        // ── Disburse pre-check gate (Vanilla buildTimelineActionButtons: the
        // Disburse button itself only renders when nach_done && customer_agreement_done,
        // on top of status) — enforced server-side here so the generic /status route
        // and the dedicated /disburse route (which both funnel through this method)
        // can't disburse without both being marked done first. ──
        if (request.NewStatus == LoanStatus.Disbursed && !(loan.NachDone && loan.CustomerAgreementDone))
            return ApiResponseDto<LoanDto>.Fail(
                "Cannot disburse — mark both Nach and Customer Agreement as done first.");

        // ── Verified-disbursement gate (real-money safety) ──────────────────────
        // For a loan routed through the InCred lender, LoanMS must NOT reach the
        // Disbursed state on an operator's say-so alone: a verified InCred
        // disbursement-success callback must already be on record. Pending /
        // Failed / Unknown / no-callback InCred loans are blocked here, so LoanMS
        // never reports money as disbursed merely because it sent the request.
        // Loans NOT routed through InCred are the internal manual-disbursement
        // mode and are unaffected — that disbursement is an authorized internal
        // action, already role-gated (canDisburse) and audited via status history.
        // (Idempotency: once Disbursed, the transition matrix only allows Closed,
        // so a duplicate disburse is already blocked above.)
        if (request.NewStatus == LoanStatus.Disbursed && IsIncredLoan(loan) && !IsIncredDisbursementVerified(loan))
            return ApiResponseDto<LoanDto>.Fail(
                "Cannot mark this InCred loan Disbursed: no verified InCred disbursement success is on record "
                + $"(last event='{loan.IncredLastWebhookEvent ?? "none"}', status='{loan.IncredLastWebhookStatus ?? "none"}'). "
                + "A verified InCred DISBURSED/SUCCESS callback is required before this loan can be marked Disbursed.");

        var fromStatus = loan.Status;
        loan.Status    = request.NewStatus;
        loan.UpdatedAt = DateTime.UtcNow;
        // Reset the SLA-breach dedupe flag — this is a new status, so it
        // gets a fresh SLA clock and is eligible for its own breach
        // notification later, independent of whether the PREVIOUS status
        // was already notified.
        loan.SlaBreachNotifiedAt = null;

        if (request.NewStatus == LoanStatus.Approved)
        {
            loan.ApprovedAt     = DateTime.UtcNow;
            loan.ApprovedAmount = request.ApprovedAmount ?? loan.RequestedAmount;
            loan.MonthlyEmi     = CalculateEmi(loan.ApprovedAmount.Value, loan.InterestRate, loan.TenureMonths);
        }
        else if (request.NewStatus == LoanStatus.Disbursed)
        {
            loan.DisbursedAt = DateTime.UtcNow;
        }
        else if (request.NewStatus == LoanStatus.Closed)
        {
            loan.ClosedAt = DateTime.UtcNow;
        }
        else if (request.NewStatus == LoanStatus.Rejected)
        {
            // Snapshot the stage the loan was in right before rejection, and
            // when — matches Vanilla rejectApp/confirmReject (efin-app.js:10589,
            // 22925), which stamp app.preRejectedStatus/app.rejectedAt on every
            // reject. ReopenAsync below reads these to restore the exact prior
            // stage and to enforce the 45-day reopen window.
            loan.PreRejectedStatus = fromStatus;
            loan.RejectedAt        = DateTime.UtcNow;
        }

        await _uow.Loans.UpdateAsync(loan);

        await _uow.LoanStatusHistories.AddAsync(new LoanStatusHistory
        {
            LoanId          = loan.Id,
            FromStatus      = fromStatus,
            ToStatus        = request.NewStatus,
            Comment         = request.Comment,
            ChangedByUserId = changedByUserId
        });

        await _uow.SaveChangesAsync();
        // No list/dashboard cache to invalidate — see CreateAsync comment above.

        var updated = await _uow.Loans.GetWithDetailsAsync(id);

        // BUGFIX (confirmed real gap — "Stage notification emails not
        // being sent"): the "stage" template (and the status-specific
        // approval/disburse/rejection templates) existed and were fully
        // editable in Settings, but nothing on the backend ever actually
        // called IEmailService on a status change — this is the missing
        // trigger. Non-fatal by design — a failed/unconfigured email must
        // never roll back an already-successful status change.
        try
        {
            await SendStageNotificationEmailAsync(updated!, request.NewStatus, request.Comment);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Stage Notification Email] failed for loan {id}: {ex.Message}");
        }

        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"), $"Loan status updated to {request.NewStatus}.");
    }

    /// <summary>
    /// Phase 2 RBAC — G-08. Admin stage override. Unlike UpdateStatusAsync this
    /// intentionally does NOT consult GetAllowedTransitions — an Admin may force
    /// any status — but it is the ONLY transition path that skips the state
    /// machine, it still records full LoanStatusHistory (old→new + the mandatory
    /// reason), and the caller must have gated it to Admin. HasAccessAsync is
    /// still checked (Admin sees everything, so this is a belt-and-braces guard,
    /// and blocks the endpoint being wired to a non-Admin by mistake later).
    /// </summary>
    public async Task<ApiResponseDto<LoanDto>> OverrideStatusAsync(int id, LoanStatus newStatus, string reason, int changedByUserId, string changedByUserRole)
    {
        if (string.IsNullOrWhiteSpace(reason))
            return ApiResponseDto<LoanDto>.Fail("An override reason is required.");
        if (!string.Equals(changedByUserRole, "Admin", StringComparison.OrdinalIgnoreCase))
            return ApiResponseDto<LoanDto>.Fail("Stage override is restricted to Admin.");
        if (!await _uow.Loans.HasAccessAsync(id, changedByUserId, changedByUserRole))
            return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        var fromStatus = loan.Status;
        if (fromStatus == newStatus)
            return ApiResponseDto<LoanDto>.Fail($"Loan is already {newStatus}.");

        loan.Status              = newStatus;
        loan.UpdatedAt           = DateTime.UtcNow;
        loan.SlaBreachNotifiedAt = null;

        // Keep the same terminal-state bookkeeping the normal path applies.
        if (newStatus == LoanStatus.Approved)
        {
            loan.ApprovedAt ??= DateTime.UtcNow;
            loan.ApprovedAmount ??= loan.RequestedAmount;
        }
        else if (newStatus == LoanStatus.Disbursed) loan.DisbursedAt ??= DateTime.UtcNow;
        else if (newStatus == LoanStatus.Closed)     loan.ClosedAt ??= DateTime.UtcNow;
        else if (newStatus == LoanStatus.Rejected)
        {
            // Same snapshot UpdateStatusAsync takes on a normal Reject, so an
            // admin-overridden-to-Rejected loan is still eligible for the
            // normal 45-day Reopen flow instead of being stuck.
            loan.PreRejectedStatus = fromStatus;
            loan.RejectedAt        = DateTime.UtcNow;
        }

        await _uow.Loans.UpdateAsync(loan);
        await _uow.LoanStatusHistories.AddAsync(new LoanStatusHistory
        {
            LoanId          = loan.Id,
            FromStatus      = fromStatus,
            ToStatus        = newStatus,
            Comment         = $"[ADMIN OVERRIDE] {reason}",
            ChangedByUserId = changedByUserId
        });
        await _uow.SaveChangesAsync();

        var updated = await _uow.Loans.GetWithDetailsAsync(id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"),
            $"Loan status overridden from {fromStatus} to {newStatus}.");
    }

    /// <summary>
    /// Re-open a Rejected loan — Vanilla parity for reopenApp (efin-app.js:10600).
    /// Admin-only (Vanilla's guardFinalLock only lets Admin modify a
    /// final-locked/Rejected app; the button is shown to other roles there too,
    /// but guardFinalLock blocks the actual mutation for anyone but Admin —
    /// button-presence parity is explicitly out of scope here, only the
    /// enforced permission is). Two Vanilla rules enforced exactly:
    ///   1. Hard 45-day window from the loan's original creation date
    ///      (RejectedAt is NOT the anchor — CreatedAt is, same as Vanilla's
    ///      `createdAt` there), after which reopen is blocked outright.
    ///   2. Restores to PreRejectedStatus (the stage snapshotted at reject
    ///      time), not an admin-picked status — Vanilla falls back to 'login'
    ///      if that snapshot is missing (e.g. legacy data); LoanMS's nearest
    ///      equivalent stage is Submitted, used here for the same fallback.
    /// Does not attempt file-attachment parity (Vanilla's reopen modal allows
    /// optional file uploads) — attachments can be added via the existing
    /// loan-documents endpoint after reopening; flagged separately, not
    /// silently dropped.
    /// </summary>
    public async Task<ApiResponseDto<LoanDto>> ReopenAsync(int id, string reason, int changedByUserId, string changedByUserRole)
    {
        if (string.IsNullOrWhiteSpace(reason))
            return ApiResponseDto<LoanDto>.Fail("A remark is required to re-open this application.");
        if (!string.Equals(changedByUserRole, "Admin", StringComparison.OrdinalIgnoreCase))
            return ApiResponseDto<LoanDto>.Fail("Re-open is restricted to Admin.");
        if (!await _uow.Loans.HasAccessAsync(id, changedByUserId, changedByUserRole))
            return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        if (loan.Status != LoanStatus.Rejected)
            return ApiResponseDto<LoanDto>.Fail("Only a Rejected application can be re-opened.");

        var daysElapsed = (DateTime.UtcNow - loan.CreatedAt).TotalDays;
        if (daysElapsed > 45)
            return ApiResponseDto<LoanDto>.Fail("Re-open window has expired (45 days from creation date).");

        var restoreStatus = loan.PreRejectedStatus ?? LoanStatus.Submitted;

        var fromStatus = loan.Status;
        loan.Status              = restoreStatus;
        loan.UpdatedAt           = DateTime.UtcNow;
        loan.SlaBreachNotifiedAt = null;
        loan.PreRejectedStatus   = null;
        loan.RejectedAt          = null;

        await _uow.Loans.UpdateAsync(loan);
        await _uow.LoanStatusHistories.AddAsync(new LoanStatusHistory
        {
            LoanId          = loan.Id,
            FromStatus      = fromStatus,
            ToStatus        = restoreStatus,
            Comment         = $"[RE-OPENED] {reason}",
            ChangedByUserId = changedByUserId
        });
        await _uow.SaveChangesAsync();

        var updated = await _uow.Loans.GetWithDetailsAsync(id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"),
            $"Application re-opened, resumed at {restoreStatus}.");
    }

    // States from which a loan may be put on hold. Draft (not yet submitted),
    // and the terminal/locked states (Rejected/Disbursed/Closed) cannot —
    // matching legacy's EDIT_BLOCKED/FINAL_LOCK stages, which lock rejected/
    // disbursed/cancelled. Hold is for pausing an in-flight application.
    private static readonly HashSet<LoanStatus> _holdableStates = new()
    {
        LoanStatus.Submitted, LoanStatus.UnderReview, LoanStatus.Approved, LoanStatus.Acceptance
    };

    public async Task<ApiResponseDto<LoanDto>> HoldAsync(int id, string reason, int changedByUserId, string changedByUserRole)
    {
        if (string.IsNullOrWhiteSpace(reason))
            return ApiResponseDto<LoanDto>.Fail("A hold reason is required.");

        // Same visibility/location scoping every other transition uses.
        if (!await _uow.Loans.HasAccessAsync(id, changedByUserId, changedByUserRole))
            return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        if (loan.Status == LoanStatus.OnHold)
            return ApiResponseDto<LoanDto>.Fail("This loan is already on hold.");
        if (!_holdableStates.Contains(loan.Status))
            return ApiResponseDto<LoanDto>.Fail($"A loan in {loan.Status} cannot be put on hold.");

        var fromStatus = loan.Status;
        loan.Status = LoanStatus.OnHold;
        loan.UpdatedAt = DateTime.UtcNow;
        loan.SlaBreachNotifiedAt = null;
        await _uow.Loans.UpdateAsync(loan);

        // History records the exact status held before the hold — that's what
        // Un-hold reads back to restore, so no new column is needed.
        await _uow.LoanStatusHistories.AddAsync(new LoanStatusHistory
        {
            LoanId = loan.Id, FromStatus = fromStatus, ToStatus = LoanStatus.OnHold,
            Comment = reason, ChangedByUserId = changedByUserId
        });
        await _uow.SaveChangesAsync();

        var updated = await _uow.Loans.GetWithDetailsAsync(id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"), "Loan placed on hold.");
    }

    public async Task<ApiResponseDto<LoanDto>> UnholdAsync(int id, string? comment, int changedByUserId, string changedByUserRole)
    {
        if (!await _uow.Loans.HasAccessAsync(id, changedByUserId, changedByUserRole))
            return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        if (loan.Status != LoanStatus.OnHold)
            return ApiResponseDto<LoanDto>.Fail("This loan is not on hold.");

        // Restore whatever status the loan held immediately before the hold —
        // the FromStatus of the most recent history row whose ToStatus is
        // OnHold. Falls back to Submitted if (defensively) none is found.
        var history = await _uow.LoanStatusHistories.GetByLoanIdAsync(id);
        var lastHold = history
            .Where(h => h.ToStatus == LoanStatus.OnHold)
            .OrderByDescending(h => h.CreatedAt)
            .FirstOrDefault();
        var restoreTo = lastHold?.FromStatus ?? LoanStatus.Submitted;

        loan.Status = restoreTo;
        loan.UpdatedAt = DateTime.UtcNow;
        loan.SlaBreachNotifiedAt = null;
        await _uow.Loans.UpdateAsync(loan);

        await _uow.LoanStatusHistories.AddAsync(new LoanStatusHistory
        {
            LoanId = loan.Id, FromStatus = LoanStatus.OnHold, ToStatus = restoreTo,
            Comment = string.IsNullOrWhiteSpace(comment) ? "Hold released." : comment,
            ChangedByUserId = changedByUserId
        });
        await _uow.SaveChangesAsync();

        var updated = await _uow.Loans.GetWithDetailsAsync(id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"), $"Loan resumed at {restoreTo}.");
    }

    public async Task<ApiResponseDto<List<LoanDeviationDto>>> GetDeviationsAsync(int id, int currentUserId, string currentUserRole)
    {
        if (!await _uow.Loans.HasAccessAsync(id, currentUserId, currentUserRole))
            return ApiResponseDto<List<LoanDeviationDto>>.Fail("Loan not found.");

        var loan = await _uow.Loans.GetWithDetailsAsync(id);
        if (loan == null) return ApiResponseDto<List<LoanDeviationDto>>.Fail("Loan not found.");

        // Approved amount is the sanctioned figure once set; before approval
        // the requested amount is what's being underwritten. EMI/ROI/tenure
        // come off the loan; salary/CIBIL/employment off its customer.
        var amount = loan.ApprovedAmount ?? loan.RequestedAmount;

        // Locked Phase-7 rule: for SALARIED applicants the FOIR-deviation calc uses
        // the bank-VERIFIED income when the IncomeVerification qualifies
        // (AutoVerified / ManualReviewCompleted-Approved), else declared. Read from
        // the persisted backend result, never a client flag. Self-employed income
        // is untouched (its FOIR keeps the existing Perfios-ABB path elsewhere).
        var declaredIncome = loan.Customer?.MonthlyIncome ?? 0m;
        var incomeForCalc = declaredIncome;
        if (_incomeVerification != null && IsSalaried(loan.Customer?.EmploymentType))
        {
            var verified = await _incomeVerification.GetTrustedVerifiedIncomeAsync(loan.Id);
            if (verified is > 0m) incomeForCalc = verified.Value;
        }

        var flags = DeviationEvaluator.Evaluate(
            loan.LoanType, amount, loan.TenureMonths, loan.InterestRate,
            loan.MonthlyEmi ?? 0m,
            incomeForCalc,
            loan.Customer?.CibilScore ?? 0,
            loan.Customer?.EmploymentType);

        return ApiResponseDto<List<LoanDeviationDto>>.Ok(flags);
    }

    // ── Deviation workflow (Raise → Decision → Approve/Reject, plus Skip) ─────
    // Ported from legacy's confirmDeviation/confirmSkipDeviation. Kept off the
    // generic state machine (GetAllowedTransitions) so only these dedicated,
    // canDeviation-gated methods can move a loan into/out of Decision — the
    // same containment OnHold uses. No new Loan columns: the deviation
    // type/reason live in the status-history comment, and the raiser (for
    // self-approval prevention) is read back from that history row.

    private async Task<(Loan? loan, ApiResponseDto<LoanDto>? error)> LoadForTransition(int id, int userId, string role)
    {
        if (!await _uow.Loans.HasAccessAsync(id, userId, role))
            return (null, ApiResponseDto<LoanDto>.Fail("Loan not found."));
        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return (null, ApiResponseDto<LoanDto>.Fail("Loan not found."));
        return (loan, null);
    }

    private async Task<ApiResponseDto<LoanDto>> ApplyDeviationTransition(
        Loan loan, LoanStatus to, string comment, int userId)
    {
        var from = loan.Status;
        loan.Status = to;
        loan.UpdatedAt = DateTime.UtcNow;
        loan.SlaBreachNotifiedAt = null;
        if (to == LoanStatus.Approved)
        {
            loan.ApprovedAt ??= DateTime.UtcNow;
            loan.ApprovedAmount ??= loan.RequestedAmount;
            loan.MonthlyEmi ??= CalculateEmi(loan.ApprovedAmount.Value, loan.InterestRate, loan.TenureMonths);
        }
        await _uow.Loans.UpdateAsync(loan);
        await _uow.LoanStatusHistories.AddAsync(new LoanStatusHistory
        {
            LoanId = loan.Id, FromStatus = from, ToStatus = to, Comment = comment, ChangedByUserId = userId
        });
        await _uow.SaveChangesAsync();
        var updated = await _uow.Loans.GetWithDetailsAsync(loan.Id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"), $"Loan moved to {to}.");
    }

    public async Task<ApiResponseDto<LoanDto>> RaiseDeviationAsync(int id, string deviationType, string reason, int changedByUserId, string changedByUserRole)
    {
        if (string.IsNullOrWhiteSpace(deviationType)) return ApiResponseDto<LoanDto>.Fail("A deviation type is required.");
        if (string.IsNullOrWhiteSpace(reason)) return ApiResponseDto<LoanDto>.Fail("A deviation reason is required.");

        var (loan, error) = await LoadForTransition(id, changedByUserId, changedByUserRole);
        if (error != null) return error;
        if (loan!.Status != LoanStatus.UnderReview)
            return ApiResponseDto<LoanDto>.Fail($"A deviation can only be raised on an Under Review loan (this loan is {loan.Status}).");

        return await ApplyDeviationTransition(loan, LoanStatus.Decision,
            $"Deviation Type: {deviationType} | Reason: {reason}", changedByUserId);
    }

    public async Task<ApiResponseDto<LoanDto>> DecideDeviationAsync(int id, bool approve, string? comment, int changedByUserId, string changedByUserRole)
    {
        var (loan, error) = await LoadForTransition(id, changedByUserId, changedByUserRole);
        if (error != null) return error;
        if (loan!.Status != LoanStatus.Decision)
            return ApiResponseDto<LoanDto>.Fail($"Only a loan awaiting a deviation decision can be decided (this loan is {loan.Status}).");

        // Self-approval prevention: whoever raised the deviation (the
        // ChangedByUserId of the most recent →Decision history row) cannot
        // approve it themselves, unless they are Admin. Rejecting your own
        // raised deviation is allowed (it's declining, not self-clearing).
        if (approve && !string.Equals(changedByUserRole, "Admin", StringComparison.OrdinalIgnoreCase))
        {
            var history = await _uow.LoanStatusHistories.GetByLoanIdAsync(id);
            var raise = history.Where(h => h.ToStatus == LoanStatus.Decision)
                               .OrderByDescending(h => h.CreatedAt).FirstOrDefault();
            if (raise != null && raise.ChangedByUserId == changedByUserId)
                return ApiResponseDto<LoanDto>.Fail("You cannot approve a deviation you raised — it must be decided by a Team Leader or Admin.");
        }

        var to = approve ? LoanStatus.Approved : LoanStatus.Rejected;
        var note = approve
            ? (string.IsNullOrWhiteSpace(comment) ? "Deviation approved." : $"Deviation approved. {comment}")
            : (string.IsNullOrWhiteSpace(comment) ? "Deviation rejected." : $"Deviation rejected. {comment}");
        return await ApplyDeviationTransition(loan, to, note, changedByUserId);
    }

    public async Task<ApiResponseDto<LoanDto>> SkipDeviationAsync(int id, string? comment, int changedByUserId, string changedByUserRole)
    {
        var (loan, error) = await LoadForTransition(id, changedByUserId, changedByUserRole);
        if (error != null) return error;
        if (loan!.Status != LoanStatus.UnderReview)
            return ApiResponseDto<LoanDto>.Fail($"A deviation can only be skipped on an Under Review loan (this loan is {loan.Status}).");

        return await ApplyDeviationTransition(loan, LoanStatus.Approved,
            string.IsNullOrWhiteSpace(comment) ? "Deviation skipped — proceeding." : $"Deviation skipped. {comment}",
            changedByUserId);
    }

    /// <summary>
    /// Sends the general "stage" notification for every status change, plus
    /// the status-specific "approval"/"disburse"/"rejection" template when
    /// the new status matches one of those three. Both use DB-saved
    /// overrides (Settings → All Email Templates) when present, falling
    /// back to a built-in default otherwise — same reasoning as
    /// UsersController.SendInvitationEmailAsync (this server-side trigger
    /// has no access to the frontend's own default template text).
    /// </summary>
    private async Task SendStageNotificationEmailAsync(Loan loan, LoanStatus newStatus, string? comment)
    {
        if (loan.Customer == null || string.IsNullOrWhiteSpace(loan.Customer.Email)) return;

        var vars = new Dictionary<string, string>
        {
            ["{{name}}"] = loan.Customer.FullName ?? "",
            ["{{app_id}}"] = loan.LoanNumber ?? loan.Id.ToString(),
            ["{{stage}}"] = newStatus.ToString(),
            ["{{amount}}"] = (loan.ApprovedAmount ?? loan.RequestedAmount).ToString("N0"),
            ["{{loan_type}}"] = loan.LoanType.ToString(),
            ["{{roi}}"] = loan.InterestRate.ToString("0.0") + "%",
            ["{{emi}}"] = (loan.MonthlyEmi ?? 0).ToString("N0"),
            ["{{emi_date}}"] = (loan.DisbursedAt ?? DateTime.UtcNow).AddMonths(1).ToString("dd MMM yyyy"),
            ["{{reason}}"] = comment ?? "",
            ["{{signature}}"] = "LoanMS Team"
        };

        async Task SendOne(string templateKey, string defaultSubject, string defaultBody)
        {
            var (dbSubject, dbBody) = await _emailTemplates.GetTemplateAsync(templateKey);
            var subject = dbSubject ?? defaultSubject;
            var body    = dbBody ?? defaultBody;
            foreach (var kv in vars) { subject = subject.Replace(kv.Key, kv.Value); body = body.Replace(kv.Key, kv.Value); }
            await _emailService.SendAsync(loan.Customer.Email!, loan.Customer.FullName ?? "", subject, body);
        }

        // General "stage" notification — every status change.
        await SendOne("stage",
            "Your Loan Application {{app_id}} — Status Update",
            "<p>Dear {{name}},</p><p>Your loan application <strong>{{app_id}}</strong> has moved to stage: <strong>{{stage}}</strong>.</p><p style=\"color:#9ca3af;font-size:12px\">{{signature}}</p>");

        // Status-specific template, on top of (not instead of) the general one.
        if (newStatus == LoanStatus.Approved)
        {
            await SendOne("approval",
                "Your Loan {{app_id}} Has Been Approved ✅",
                "<p>Dear {{name}},</p><p>Congratulations! Your {{loan_type}} application <strong>{{app_id}}</strong> for ₹{{amount}} at {{roi}} has been approved.</p><p style=\"color:#9ca3af;font-size:12px\">{{signature}}</p>");
        }
        else if (newStatus == LoanStatus.Disbursed)
        {
            await SendOne("disburse",
                "Loan {{app_id}} Disbursed 🏦",
                "<p>Dear {{name}},</p><p>Your {{loan_type}} amount of ₹{{amount}} has been disbursed. Your first EMI of ₹{{emi}} is due on {{emi_date}}.</p><p style=\"color:#9ca3af;font-size:12px\">{{signature}}</p>");
        }
        else if (newStatus == LoanStatus.Rejected)
        {
            await SendOne("rejection",
                "Update on Your Loan Application {{app_id}}",
                "<p>Dear {{name}},</p><p>We regret to inform you that your {{loan_type}} application <strong>{{app_id}}</strong> could not be approved at this time.{{reason}}</p><p style=\"color:#9ca3af;font-size:12px\">{{signature}}</p>");
        }
    }

    /// <summary>
    /// Sales Team / Operations Manager assignment (linked-users visibility
    /// fix — see UpdateLoanAssignmentRequestDto for why this is separate
    /// from UpdateAsync). Same HasAccessAsync check every other
    /// loan-mutating method uses; works regardless of loan status, unlike
    /// UpdateAsync. Each field is independently optional: sending only
    /// SalesTeamName leaves OpsManagerId untouched, and vice versa; the
    /// Clear* flags are how a caller explicitly removes a value rather
    /// than just not mentioning it.
    /// </summary>
    public async Task<ApiResponseDto<LoanDto>> UpdateAssignmentAsync(int id, UpdateLoanAssignmentRequestDto request, int currentUserId, string currentUserRole)
    {
        if (!await _uow.Loans.HasAccessAsync(id, currentUserId, currentUserRole))
            return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        if (request.OpsManagerId.HasValue)
        {
            var opsManagerError = await ValidateAssigneeAsync(request.OpsManagerId);
            if (opsManagerError != null) return ApiResponseDto<LoanDto>.Fail(opsManagerError);
            loan.OpsManagerId = request.OpsManagerId;
        }
        else if (request.ClearOpsManager)
        {
            loan.OpsManagerId = null;
        }

        if (request.SalesTeamName != null)
        {
            loan.SalesTeamName = request.SalesTeamName;
        }
        else if (request.ClearSalesTeam)
        {
            loan.SalesTeamName = null;
        }

        // ── Extended: Login User, Sales Person, Location (same pattern) ──
        if (request.LoginUserId.HasValue)
        {
            var loginUserError = await ValidateAssigneeAsync(request.LoginUserId);
            if (loginUserError != null) return ApiResponseDto<LoanDto>.Fail(loginUserError);
            loan.LoginUserId = request.LoginUserId;
        }
        else if (request.ClearLoginUser)
        {
            loan.LoginUserId = null;
        }

        if (request.AssignedToUserId.HasValue)
        {
            var assignedToError = await ValidateAssigneeAsync(request.AssignedToUserId);
            if (assignedToError != null) return ApiResponseDto<LoanDto>.Fail(assignedToError);
            loan.AssignedToUserId = request.AssignedToUserId;
        }
        else if (request.ClearAssignedTo)
        {
            loan.AssignedToUserId = null;
        }

        if (request.LocationId.HasValue)
        {
            // Lightweight existence check (Locations, not Users — different
            // table, so ValidateAssigneeAsync doesn't apply here).
            var locationExists = await _uow.Loans.LocationExistsAsync(request.LocationId.Value);
            if (!locationExists) return ApiResponseDto<LoanDto>.Fail("Selected location was not found.");
            loan.LocationId = request.LocationId;
        }
        else if (request.ClearLocation)
        {
            loan.LocationId = null;
        }

        loan.UpdatedAt = DateTime.UtcNow;
        await _uow.Loans.UpdateAsync(loan);
        await _uow.SaveChangesAsync();

        var updated = await _uow.Loans.GetWithDetailsAsync(id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"), "Assignment updated.");
    }

    /// <summary>
    /// Per-loan Lender RM override (Lender Email Workflow) — mirrors Vanilla's
    /// _lewSaveRmOverride (lender-email-workflow.js:748). Sets the RM contact
    /// for this application only and records a timeline/status-history entry,
    /// exactly like Vanilla's "EFIN-Lender RM Updated" tracking entry.
    /// </summary>
    public async Task<ApiResponseDto<LoanDto>> UpdateLenderRmAsync(int id, UpdateLenderRmRequestDto request, int currentUserId, string currentUserRole)
    {
        if (!await _uow.Loans.HasAccessAsync(id, currentUserId, currentUserRole))
            return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        if (string.IsNullOrWhiteSpace(request.RmName) || string.IsNullOrWhiteSpace(request.RmEmail))
            return ApiResponseDto<LoanDto>.Fail("RM Name and Email are required.");

        var prevName = loan.LenderRmName;
        var prevEmail = loan.LenderRmEmail;
        loan.LenderRmName   = request.RmName.Trim();
        loan.LenderRmEmail  = request.RmEmail.Trim();
        loan.LenderRmMobile = string.IsNullOrWhiteSpace(request.RmMobile) ? null : request.RmMobile.Trim();

        await _uow.Loans.UpdateAsync(loan);

        // Audit trail — a same-status history entry with the change note, so it
        // surfaces in the Timeline (Status History) like Vanilla's tracking row.
        await _uow.LoanStatusHistories.AddAsync(new LoanStatusHistory
        {
            LoanId          = loan.Id,
            FromStatus      = loan.Status,
            ToStatus        = loan.Status,
            Comment         = prevEmail == null
                ? $"Lender RM assigned: {loan.LenderRmName} ({loan.LenderRmEmail})"
                : $"Lender RM updated: {loan.LenderRmName} ({loan.LenderRmEmail}). Previous: {prevName} ({prevEmail})",
            ChangedByUserId = currentUserId
        });
        await _uow.SaveChangesAsync();

        var updated = await _uow.Loans.GetWithDetailsAsync(id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"), $"Lender RM updated: {loan.LenderRmName}.");
    }

    // Overview parity fields — partial update of InCred RM / Analytic Bank and
    // the five underwriting verification flags (Vanilla efin-app.js:2479 /
    // 3699-3702). Every field is optional so a single check modal can flip its
    // own flag without disturbing the others.
    public async Task<ApiResponseDto<LoanDto>> UpdateOverviewAsync(int id, UpdateLoanOverviewRequestDto request, int currentUserId, string currentUserRole)
    {
        if (!await _uow.Loans.HasAccessAsync(id, currentUserId, currentUserRole))
            return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        if (request.IncredRmName != null)
            loan.IncredRmName = string.IsNullOrWhiteSpace(request.IncredRmName) ? null : request.IncredRmName.Trim();
        if (request.AnalyticBank != null)
            loan.AnalyticBank = string.IsNullOrWhiteSpace(request.AnalyticBank) ? null : request.AnalyticBank.Trim();
        if (request.DocumentChecked.HasValue) loan.DocumentChecked = request.DocumentChecked.Value;
        // SECURITY (Phase 5, vuln S1): IncomeChecked is NO LONGER client-settable
        // here. It is now DERIVED solely from an authoritative IncomeVerification
        // run (IncomeVerificationService), so a browser can never mark income
        // "verified" by PATCHing this flag. The request field is intentionally
        // ignored; income completion flows through /income-verification/run.
        // (The column itself is kept for DB/back-compat, per §11.)
        if (request.BankChecked.HasValue)     loan.BankChecked     = request.BankChecked.Value;
        if (request.EcsReturn.HasValue)       loan.EcsReturn       = request.EcsReturn.Value;
        if (request.FiReportChecked.HasValue) loan.FiReportChecked = request.FiReportChecked.Value;
        if (request.NachDone.HasValue)             loan.NachDone             = request.NachDone.Value;
        if (request.CustomerAgreementDone.HasValue) loan.CustomerAgreementDone = request.CustomerAgreementDone.Value;

        await _uow.Loans.UpdateAsync(loan);
        await _uow.SaveChangesAsync();

        var updated = await _uow.Loans.GetWithDetailsAsync(id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"), "Overview updated.");
    }

    /// <summary>
    /// Whole-table replace for a loan's Bank Lines (Application Number /
    /// Approved Loan / Remarks per bank the application was sent to) —
    /// previously frontend-only. Same visibility gate as every other
    /// loan-mutating method; no status restriction (a lender detail can be
    /// updated at any stage, same reasoning as UpdateAssignmentAsync).
    /// </summary>
    public async Task<ApiResponseDto<LoanDto>> UpdateBankLinesAsync(int id, UpdateLoanBankLinesRequestDto request, int currentUserId, string currentUserRole)
    {
        if (!await _uow.Loans.HasAccessAsync(id, currentUserId, currentUserRole))
            return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        if ((request.BankLines ?? new List<BankLineItemDto>()).Any(l => l.ApprovedLoan < 0))
            return ApiResponseDto<LoanDto>.Fail("Approved loan amount cannot be negative.");

        var newLines = (request.BankLines ?? new List<BankLineItemDto>()).Select(l => new LoanBankLine
        {
            BankName = l.BankName ?? string.Empty,
            TempApplicationNumber = l.TempApplicationNumber ?? string.Empty,
            ApplicationNumber = l.ApplicationNumber,
            ApprovedLoan = l.ApprovedLoan,
            Remarks = l.Remarks
        }).ToList();

        await _uow.Loans.ReplaceBankLinesAsync(id, newLines);

        var updated = await _uow.Loans.GetWithDetailsAsync(id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"), "Bank details saved.");
    }

    public async Task<ApiResponseDto<LoanDto>> UpdateReferencesAsync(int id, List<UpdateLoanReferenceItemDto> request, int currentUserId, string currentUserRole)
    {
        if (!await _uow.Loans.HasAccessAsync(id, currentUserId, currentUserRole))
            return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        var newRefs = (request ?? new List<UpdateLoanReferenceItemDto>())
            .Where(r => !string.IsNullOrWhiteSpace(r.Name))
            .Select(r => new LoanReference { Name = r.Name!, Mobile = r.Mobile ?? string.Empty, Relation = r.Relation ?? string.Empty, Address = r.Address, RefNumber = r.RefNumber })
            .ToList();

        await _uow.Loans.ReplaceReferencesAsync(id, newRefs);

        var updated = await _uow.Loans.GetWithDetailsAsync(id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"), "References saved.");
    }

    public async Task<ApiResponseDto<bool>> DeleteAsync(int id, int currentUserId, string currentUserRole)
    {
        // Delete is no longer Admin-only at the controller — every role can
        // reach this for the "Discard draft" action in the wizard (see
        // LoansController.Delete). The general HasAccessAsync visibility
        // scope (Dsa/Partner via linked-record indirection, Manager via
        // Location/Team) doesn't line up with drafts, which are only ever
        // owned by their creator (WizardController always sets
        // CreatedByUserId from the JWT, never from the request). So a
        // Draft's own creator, or an Admin/Manager, may delete it — the
        // exact same rule already used for GetDraft/ListDrafts in
        // WizardController — instead of relying on the broader
        // Sales/Dsa/Partner/Manager visibility scope built for the general
        // loan-management screens.
        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<bool>.Fail("Loan not found.");
        if (loan.Status != LoanStatus.Draft)
            return ApiResponseDto<bool>.Fail("Only Draft loans can be deleted.");

        var isInternal = _internalRoles.Contains(currentUserRole ?? string.Empty);
        if (!isInternal && loan.CreatedByUserId != currentUserId)
            return ApiResponseDto<bool>.Fail("Loan not found.");

        await _uow.Loans.DeleteAsync(id);
        await _uow.SaveChangesAsync();
        // No list cache to invalidate — see CreateAsync comment above.

        return ApiResponseDto<bool>.Ok(true, "Loan deleted.");
    }

    public async Task<ApiResponseDto<DashboardStatsDto>> GetDashboardStatsAsync(int userId, string role)
    {
        // Phase 3 — same fix as GetAllAsync (Phase 1): dashboard totals must
        // always reflect the current database state, so this reads straight
        // through to the repository, no cache in front of it.
        //
        // The previous per-user/role cache here relied on
        // ICacheService.RemoveByPrefixAsync("dashboard:") for invalidation on
        // every create/update/status-change/delete. That is a no-op on the
        // Redis-backed DistributedCacheService (see CacheService.cs), and even
        // with the correctly-implemented MemoryCacheService fallback, ECS runs
        // multiple Fargate task replicas each with their own independent
        // IMemoryCache — invalidating on the replica that handled Device A's
        // create does nothing for the replica that serves Device B's dashboard
        // request. Either way, totals could lag up to the old 60s TTL across
        // devices/replicas, exactly like the list bug this mirrors.
        var stats = await _uow.Loans.GetDashboardStatsAsync(userId, role);
        return ApiResponseDto<DashboardStatsDto>.Ok(stats);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /// <summary>
    /// Phase 4 (Loan Assignee Validation) — single source of truth for
    /// "is this user-id valid to set on a loan", used for both
    /// AssignedToUserId (Sales Person) and LoginUserId (Login Team
    /// processor) — same rule (must exist + be active) applies to either.
    /// Null is a valid input (unassigned). Returns an error message if
    /// invalid, or null if acceptable (or none was provided).
    /// </summary>
    private async Task<string?> ValidateAssigneeAsync(int? assignedToUserId)
    {
        if (!assignedToUserId.HasValue) return null;

        var assignee = await _uow.Users.GetByIdAsync(assignedToUserId.Value);
        if (assignee == null) return "Assigned user not found.";
        if (!assignee.IsActive) return "Assigned user is inactive.";
        return null;
    }

    private static decimal CalculateEmi(decimal principal, decimal ratePercent, int months)
    {
        if (ratePercent == 0) return Math.Round(principal / months, 2);
        var r   = ratePercent / 12 / 100;
        var emi = principal * r * (decimal)Math.Pow((double)(1 + r), months)
                  / ((decimal)Math.Pow((double)(1 + r), months) - 1);
        return Math.Round(emi, 2);
    }

    private static List<LoanStatus> GetAllowedTransitions(LoanStatus current) => current switch
    {
        LoanStatus.Draft       => new() { LoanStatus.Submitted, LoanStatus.Rejected },
        LoanStatus.Submitted   => new() { LoanStatus.UnderReview, LoanStatus.Rejected },
        LoanStatus.UnderReview => new() { LoanStatus.Approved, LoanStatus.Rejected },
        // Direct Approved → Disbursed stays allowed (loans that skip a recorded
        // deal-confirmation step); Approved → Acceptance is the new parity path
        // for loans that go through Send Deal Confirmation first.
        LoanStatus.Approved    => new() { LoanStatus.Acceptance, LoanStatus.Disbursed, LoanStatus.Rejected },
        LoanStatus.Acceptance  => new() { LoanStatus.Disbursed, LoanStatus.Rejected },
        LoanStatus.Disbursed   => new() { LoanStatus.Closed },
        _                      => new()
    };

    // A loan is "routed through InCred" once it carries the InCred origination
    // marker (ApplicationSource=incred) or an InCred application id. Only these
    // loans are subject to the verified-disbursement gate.
    internal static bool IsIncredLoan(Loan loan) =>
        !string.IsNullOrWhiteSpace(loan.IncredApplicationId) ||
        string.Equals(loan.ApplicationSource, "incred", StringComparison.OrdinalIgnoreCase);

    // "Verified InCred disbursement success" = the last recorded InCred callback
    // reports a disbursement event with a success status. Matching is token-based
    // and case-insensitive rather than tied to one exact provider string, so it
    // is robust across DISBURSED / DISBURSEMENT / DISBURSAL wording without
    // inventing a specific provider signature contract. Pending / Failed /
    // Unknown / empty (no callback) all return false → blocked.
    internal static bool IsIncredDisbursementVerified(Loan loan)
    {
        var evt    = (loan.IncredLastWebhookEvent  ?? string.Empty).Trim().ToUpperInvariant();
        var status = (loan.IncredLastWebhookStatus ?? string.Empty).Trim().ToUpperInvariant();
        var eventIsDisbursement = evt.Contains("DISBURS");
        var statusIsSuccess     = status.Contains("SUCCESS") || status == "COMPLETED"
                               || status == "DISBURSED" || status == "DONE";
        return eventIsDisbursement && statusIsSuccess;
    }

    internal static LoanDto MapToDto(Loan l, string callerRole = "Sales", HashSet<string>? deniedTabs = null)
    {
        var isInternal = _internalRoles.Contains(callerRole);
        var isElevated = _elevatedRoles.Contains(callerRole);
        // Tab Data Access (Roles & Permissions matrix) — Admin-configurable,
        // on top of (never instead of) the existing isElevated PAN/Aadhaar
        // masking above. Deliberately conservative: FullName/Email/Phone
        // stay visible even with canViewPersonal off (used for basic
        // record-identification throughout the UI, not just this one tab —
        // hiding them entirely risks breaking assumptions elsewhere this
        // pass can't fully audit); only the more Personal-Details-specific
        // fields (DOB/Gender/FatherName) and the genuinely tab-scoped
        // Address/Employment field groups are masked. "References" has no
        // backend representation to mask (never persisted server-side —
        // same class of gap as Bank Lines before that was fixed), so
        // canViewReferences is intentionally not checked here.
        var hidePersonal   = deniedTabs != null && deniedTabs.Contains("canViewPersonal");
        var hideAddress    = deniedTabs != null && deniedTabs.Contains("canViewAddress");
        var hideEmployment = deniedTabs != null && deniedTabs.Contains("canViewEmployment");

        return new LoanDto
        {
            Id              = l.Id,
            LoanNumber      = l.LoanNumber,
            LoanType        = l.LoanType.ToString(),
            Status          = l.Status.ToString(),
            RequestedAmount = l.RequestedAmount,
            ApprovedAmount  = l.ApprovedAmount,
            InterestRate    = l.InterestRate,
            TenureMonths    = l.TenureMonths,
            MonthlyEmi      = l.MonthlyEmi,
            Purpose         = l.Purpose,
            // Remarks contain lender name, channel, source — internal only
            Remarks         = isInternal ? l.Remarks : null,
            ApprovedAt      = l.ApprovedAt,
            DisbursedAt     = l.DisbursedAt,
            CreatedAt       = l.CreatedAt,
            Customer = new CustomerDto
            {
                Id            = l.Customer.Id,
                FullName      = l.Customer.FullName,
                Email         = l.Customer.Email,
                Phone         = l.Customer.Phone,
                // PAN and Aadhaar masked for non-elevated roles
                PanNumber     = isElevated ? l.Customer.PanNumber     : CustomerService.MaskPan(l.Customer.PanNumber),
                AadhaarNumber = isElevated ? l.Customer.AadhaarNumber : CustomerService.MaskAadhaar(l.Customer.AadhaarNumber),
                CibilScore    = l.Customer.CibilScore,
                DateOfBirth        = hidePersonal   ? null : l.Customer.DateOfBirth,
                Gender             = hidePersonal   ? null : l.Customer.Gender,
                FatherName         = hidePersonal   ? null : l.Customer.FatherName,
                MotherName         = hidePersonal   ? null : l.Customer.MotherName,
                AlternatePhone     = hidePersonal   ? null : l.Customer.AlternatePhone,
                Address            = hideAddress    ? null : l.Customer.Address,
                City               = hideAddress    ? null : l.Customer.City,
                State              = hideAddress    ? null : l.Customer.State,
                PinCode            = hideAddress    ? null : l.Customer.PinCode,
                ResidenceType      = hideAddress    ? null : l.Customer.ResidenceType,
                HouseNo                = hideAddress ? null : l.Customer.HouseNo,
                PermanentHouseNo       = hideAddress ? null : l.Customer.PermanentHouseNo,
                PermanentAddress       = hideAddress ? null : l.Customer.PermanentAddress,
                PermanentCity          = hideAddress ? null : l.Customer.PermanentCity,
                PermanentState         = hideAddress ? null : l.Customer.PermanentState,
                PermanentPinCode       = hideAddress ? null : l.Customer.PermanentPinCode,
                PermanentResidenceType = hideAddress ? null : l.Customer.PermanentResidenceType,
                MonthlyIncome      = hideEmployment ? null : l.Customer.MonthlyIncome,
                MonthlyObligations = hideEmployment ? null : l.Customer.MonthlyObligations,
                EmploymentType     = hideEmployment ? null : l.Customer.EmploymentType,
                CompanyName        = hideEmployment ? null : l.Customer.CompanyName,
                Designation        = hideEmployment ? null : l.Customer.Designation,
                CompanyType        = hideEmployment ? null : l.Customer.CompanyType,
                OfficialEmail      = hideEmployment ? null : l.Customer.OfficialEmail,
                OfficeAddress      = hideEmployment ? null : l.Customer.OfficeAddress,
                OfficePinCode      = hideEmployment ? null : l.Customer.OfficePinCode,
            },
            CreatedBy = new UserDto
            {
                Id       = l.CreatedBy.Id,
                FullName = l.CreatedBy.FullName,
                Email    = l.CreatedBy.Email,
                Role     = l.CreatedBy.Role.ToString()
            },
            AssignedTo = l.AssignedTo == null ? null : new UserDto
            {
                Id       = l.AssignedTo.Id,
                FullName = l.AssignedTo.FullName,
                Email    = l.AssignedTo.Email,
                Role     = l.AssignedTo.Role.ToString()
            },
            LoginUser = l.LoginUser == null ? null : new UserDto
            {
                Id       = l.LoginUser.Id,
                FullName = l.LoginUser.FullName,
                Email    = l.LoginUser.Email,
                Role     = l.LoginUser.Role.ToString()
            },
            OpsManager = l.OpsManager == null ? null : new UserDto
            {
                Id       = l.OpsManager.Id,
                FullName = l.OpsManager.FullName,
                Email    = l.OpsManager.Email,
                Role     = l.OpsManager.Role.ToString()
            },
            LocationName  = l.Location?.Name,
            DsaName       = l.Dsa?.Name,
            PartnerName   = l.Partner?.Name,
            SalesTeamName = l.SalesTeamName,
            BankLines = l.BankLines?.Select(b => new LoanBankLineDto
            {
                Id = b.Id, BankName = b.BankName, TempApplicationNumber = b.TempApplicationNumber,
                ApplicationNumber = b.ApplicationNumber, ApprovedLoan = b.ApprovedLoan, Remarks = b.Remarks
            }).ToList() ?? new(),
            // "References" tab masking (Tab Data Access) — same
            // deniedTabs mechanism as Personal/Address/Employment above.
            References = (deniedTabs != null && deniedTabs.Contains("canViewReferences"))
                ? new()
                : l.References?.Select(r => new LoanReferenceDto
                    { Id = r.Id, Name = r.Name, Mobile = r.Mobile, Relation = r.Relation, Address = r.Address, RefNumber = r.RefNumber }).ToList() ?? new(),
            SanctionDetail = l.SanctionDetail == null ? null : new LoanSanctionDetailDto
            {
                SanctionLoanAmt = l.SanctionDetail.SanctionLoanAmt, SanctionTenureMonths = l.SanctionDetail.SanctionTenureMonths,
                SanctionRoi = l.SanctionDetail.SanctionRoi, SanctionEmi = l.SanctionDetail.SanctionEmi,
                StampDuty = l.SanctionDetail.StampDuty, Gst = l.SanctionDetail.Gst,
                Insurance = l.SanctionDetail.Insurance, PfPercent = l.SanctionDetail.PfPercent,
                InsuranceInBundled = l.SanctionDetail.InsuranceInBundled, PfInBundled = l.SanctionDetail.PfInBundled,
                IsBundled = l.SanctionDetail.IsBundled, IsBt = l.SanctionDetail.IsBt,
                FlatRate = l.SanctionDetail.FlatRate, EmiDate = l.SanctionDetail.EmiDate
            },
            ProductDataJson = l.ProductDataJson,
            // Lender RM override — internal routing/contact data, gated to
            // internal roles like Remarks (lender/channel data is internal-only).
            LenderRmName   = isInternal ? l.LenderRmName   : null,
            LenderRmEmail  = isInternal ? l.LenderRmEmail  : null,
            LenderRmMobile = isInternal ? l.LenderRmMobile : null,
            // Overview parity fields — InCred RM / Analytic Bank are internal
            // routing data (gated like Remarks/LenderRm); the verification
            // flags are the underwriting Doc/Income/Bank/ECS/FI badges.
            IncredRmName    = isInternal ? l.IncredRmName : null,
            AnalyticBank    = isInternal ? l.AnalyticBank : null,
            DocumentChecked = l.DocumentChecked,
            IncomeChecked   = l.IncomeChecked,
            BankChecked     = l.BankChecked,
            EcsReturn       = l.EcsReturn,
            FiReportChecked = l.FiReportChecked,
            NachDone              = l.NachDone,
            CustomerAgreementDone = l.CustomerAgreementDone,
            StatusHistory = l.StatusHistory?.Select(h => new LoanStatusHistoryDto
            {
                Id         = h.Id,
                FromStatus = h.FromStatus.ToString(),
                ToStatus   = h.ToStatus.ToString(),
                Comment    = h.Comment,
                ChangedBy  = h.ChangedBy?.FullName ?? "System",
                ChangedAt  = h.CreatedAt
            }).OrderByDescending(h => h.ChangedAt).ToList() ?? new()
        };
    }
}
