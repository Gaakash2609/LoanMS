using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;

namespace LoanMS.Application.Services;

public class LoanService : ILoanService
{
    private readonly IUnitOfWork   _uow;
    private readonly IEmailService _emailService;
    private readonly IEmailTemplateProvider _emailTemplates;
    // Phase 7 (locked rule): authoritative trusted-income resolver. Optional so
    // existing constructions/tests still compile; DI injects the real service.
    private readonly IIncomeVerificationService? _incomeVerification;
    // Clock for the 45-day re-application rule (injectable for boundary tests).
    private readonly TimeProvider _clock;
    // Offer → Sanction → Disbursement cascade (reject / reopen / override /
    // acceptance gate). Optional so existing constructions/tests still compile;
    // DI injects OfferWorkflowService.
    private readonly IOfferWorkflowHooks? _offerHooks;

    public LoanService(IUnitOfWork uow, IEmailService emailService,
        IEmailTemplateProvider emailTemplates, IIncomeVerificationService? incomeVerification = null,
        TimeProvider? clock = null, IOfferWorkflowHooks? offerHooks = null)
    {
        _uow   = uow;
        _emailService = emailService;
        _emailTemplates = emailTemplates;
        _incomeVerification = incomeVerification;
        _clock = clock ?? TimeProvider.System;
        _offerHooks = offerHooks;
    }

    // ── Offer workflow stage ownership ────────────────────────────────────────
    // These stages are entered ONLY through OfferWorkflowService, which writes
    // the offer / deviation / credit-approval / sanction / disbursement record
    // that justifies them. The generic status route, bulk status and the Admin
    // override may not move a loan into them.
    public static readonly LoanStatus[] WorkflowOwnedStages =
        { LoanStatus.Offer, LoanStatus.Decision, LoanStatus.Approved, LoanStatus.Disbursed };

    /// <summary>Loan types whose workflow includes the FI (field investigation) step
    /// (frontend TIMELINE_ACTIONS: Car / Overdraft / Insurance have none).</summary>
    public static bool RequiresFiReport(LoanType t) =>
        t is LoanType.Personal or LoanType.Business or LoanType.Home or LoanType.LAP or LoanType.Education or LoanType.Vehicle;

    /// <summary>The CPA checks (Documents / Income / Bank / ECS) — required before
    /// Underwriting (owner flow) and again at Offer entry.</summary>
    public static List<string> UnderwritingEntryBlockers(Loan loan)
    {
        var b = new List<string>();
        if (!loan.DocumentChecked) b.Add("Documents check");
        if (!loan.IncomeChecked)   b.Add("Income check");
        if (!loan.BankChecked)     b.Add("Bank details check");
        if (!loan.EcsReturn)       b.Add("ECS return check");
        return b;
    }

    /// <summary>Verification checks that must be done before the Offer stage.</summary>
    public static List<string> OfferEntryBlockers(Loan loan)
    {
        var b = UnderwritingEntryBlockers(loan);
        if (RequiresFiReport(loan.LoanType) && !loan.FiReportChecked) b.Add("FI report");
        return b;
    }

    /// <summary>Existing disbursement pre-checks (NACH + Customer Agreement, verified
    /// InCred callback for InCred loans). Null = OK. Shared by the disbursement record flow.</summary>
    public static string? DisbursementGateError(Loan loan)
    {
        if (!(loan.NachDone && loan.CustomerAgreementDone))
            return "Cannot disburse — mark both Nach and Customer Agreement as done first.";
        if (IsIncredLoan(loan) && !IsIncredDisbursementVerified(loan))
            return "Cannot mark this InCred loan Disbursed: no verified InCred disbursement success is on record "
                + $"(last event='{loan.IncredLastWebhookEvent ?? "none"}', status='{loan.IncredLastWebhookStatus ?? "none"}'). "
                + "A verified InCred DISBURSED/SUCCESS callback is required before this loan can be marked Disbursed.";
        return null;
    }

    /// <summary>Stage notification for transitions made by OfferWorkflowService
    /// (same non-fatal behaviour as UpdateStatusAsync).</summary>
    public async Task NotifyStageChangeAsync(int loanId, LoanStatus newStatus, string? comment)
    {
        try
        {
            var loan = await _uow.Loans.GetWithDetailsAsync(loanId);
            if (loan != null) await SendStageNotificationEmailAsync(loan, newStatus, comment);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Stage Notification Email] failed for loan {loanId}: {ex.Message}");
        }
    }

    // ══ Application eligibility — the central duplicate + 45-day guard ═══════
    // Every path that creates an application or moves one back into an active
    // state asks THIS code (via GuardApplicationAsync / CheckApplicationEligibilityAsync);
    // the wizard, POST /api/loans, draft submit, admin override and reopen all
    // share it. Customer identity (which customer a PAN/mobile/email is) is a
    // separate concern — CustomerService.ResolveIdentityAsync.

    /// <summary>Closed/terminal statuses. Every other status — Draft, Submitted,
    /// UnderReview, Approved, Acceptance, Disbursed (a running loan), OnHold,
    /// Decision, and any status added later — is an active / in-process
    /// application (conservative default). Also drives the DB partial unique
    /// index (AppDbContext.ActiveApplicationIndex).</summary>
    public static readonly LoanStatus[] TerminalApplicationStatuses = { LoanStatus.Rejected, LoanStatus.Closed };
    public const int ReapplyCooldownDays = 45;

    public static bool IsActiveApplicationStatus(LoanStatus status) =>
        Array.IndexOf(TerminalApplicationStatuses, status) < 0;

    /// <summary>Only closed/terminal applications can be archived.</summary>
    public static bool IsArchivableStatus(LoanStatus status) => !IsActiveApplicationStatus(status);

    /// <summary>
    /// Pure rule. May <paramref name="loans"/>' customer start (or reactivate)
    /// an application at <paramref name="nowUtc"/>? <paramref name="excludeLoanId"/>
    /// is the application being submitted/reopened itself.
    ///  1. Any other non-deleted active application → blocked (archived or not).
    ///  2. Any rejected application (deleted/archived included — neither resets
    ///     the rule) whose rejection time is unknown → blocked, admin review.
    ///  3. Latest rejection + 45 days still in the future → blocked until then.
    ///     Allowed exactly when nowUtc >= latestRejectedAt + 45 days.
    /// Rejection time = the later of RejectedAt and the last history transition
    /// into Rejected; CreatedAt/UpdatedAt are never used as a guess.
    /// </summary>
    public static ApplicationEligibilityDto EvaluateApplicationEligibility(
        IEnumerable<LoanEligibilityRow>? loans, DateTime nowUtc, int? excludeLoanId = null)
    {
        var others = (loans ?? Enumerable.Empty<LoanEligibilityRow>())
            .Where(l => excludeLoanId == null || l.Id != excludeLoanId.Value).ToList();

        var active = others.Where(l => !l.IsDeleted && IsActiveApplicationStatus(l.Status))
            .OrderByDescending(l => l.CreatedAt).FirstOrDefault();
        if (active != null)
            return new ApplicationEligibilityDto
            {
                Allowed = false, Code = ApiErrorCodes.ActiveApplicationExists,
                BlockingLoanId = active.Id, BlockingLoanNumber = active.LoanNumber,
                BlockingStatus = active.Status.ToString(), BlockingLoanCreatedByUserId = active.CreatedByUserId,
                Message = $"Active application exists: this customer already has an active application " +
                          $"({active.LoanNumber}, status {active.Status}). A new application can be created only " +
                          "after it is closed or rejected.",
            };

        var rejected = others.Where(l => l.Status == LoanStatus.Rejected).ToList();
        var unknown = rejected.FirstOrDefault(r => EffectiveRejectedAt(r) == null);
        if (unknown != null)
            return new ApplicationEligibilityDto
            {
                Allowed = false, Code = ApiErrorCodes.RejectionDateUnknown,
                BlockingLoanId = unknown.Id, BlockingLoanNumber = unknown.LoanNumber,
                BlockingStatus = unknown.Status.ToString(), BlockingLoanCreatedByUserId = unknown.CreatedByUserId,
                Message = $"Needs admin review: this customer's rejected application ({unknown.LoanNumber}) has no " +
                          "recorded rejection date, so the 45-day re-application rule cannot be checked.",
            };

        var latest = rejected.Select(r => new { Row = r, At = EffectiveRejectedAt(r)!.Value })
            .OrderByDescending(x => x.At).FirstOrDefault();
        if (latest != null)
        {
            var reapplyAfter = latest.At.AddDays(ReapplyCooldownDays);
            if (nowUtc < reapplyAfter)
                return new ApplicationEligibilityDto
                {
                    Allowed = false, Code = ApiErrorCodes.ReapplyCooldown,
                    BlockingLoanId = latest.Row.Id, BlockingLoanNumber = latest.Row.LoanNumber,
                    BlockingStatus = latest.Row.Status.ToString(), BlockingLoanCreatedByUserId = latest.Row.CreatedByUserId,
                    LatestRejectedAtUtc = latest.At, ReapplyAfterUtc = reapplyAfter,
                    Message = $"Re-application allowed after {FormatIst(reapplyAfter)}: this customer's application " +
                              $"({latest.Row.LoanNumber}) was rejected on {FormatIst(latest.At)} and a new application " +
                              $"is allowed only {ReapplyCooldownDays} days after rejection.",
                };
        }
        return ApplicationEligibilityDto.Ok();
    }

    private static DateTime? EffectiveRejectedAt(LoanEligibilityRow r) =>
        r.RejectedAt.HasValue && r.LastRejectionTransitionAt.HasValue
            ? (r.RejectedAt.Value >= r.LastRejectionTransitionAt.Value ? r.RejectedAt : r.LastRejectionTransitionAt)
            : r.RejectedAt ?? r.LastRejectionTransitionAt;

    // India Standard Time is a fixed UTC+05:30 (no DST) — no tz-database needed.
    private static string FormatIst(DateTime utc) =>
        DateTime.SpecifyKind(utc, DateTimeKind.Utc).AddMinutes(330).ToString("dd MMM yyyy, hh:mm tt") + " IST";

    /// <summary>The eligibility message this caller may see: Admin/Manager and
    /// the blocking application's own creator get the loan number/status;
    /// everyone else gets the rule without another user's application details.</summary>
    public static string DescribeEligibilityForCaller(ApplicationEligibilityDto e, int callerUserId, string? callerRole)
    {
        if (e.Allowed) return string.Empty;
        var detailed = _internalRoles.Contains(callerRole ?? string.Empty)
                       || (e.BlockingLoanCreatedByUserId.HasValue && e.BlockingLoanCreatedByUserId.Value == callerUserId);
        if (detailed) return e.Message ?? string.Empty;
        return e.Code switch
        {
            ApiErrorCodes.ActiveApplicationExists =>
                "Active application exists: this customer already has an active application. A new application " +
                "can be created only after it is closed or rejected — please contact your manager.",
            ApiErrorCodes.ReapplyCooldown =>
                $"Re-application allowed after {FormatIst(e.ReapplyAfterUtc!.Value)}: this customer's previous " +
                $"application was rejected and a new one is allowed only {ReapplyCooldownDays} days after rejection.",
            ApiErrorCodes.RejectionDateUnknown =>
                "Needs admin review: this customer has a rejected application without a recorded rejection date.",
            _ => e.Message ?? string.Empty,
        };
    }

    public async Task<ApplicationEligibilityDto> CheckApplicationEligibilityAsync(int customerId, int? excludeLoanId = null)
    {
        var rows = await _uow.Loans.GetEligibilityRowsAsync(customerId);
        return EvaluateApplicationEligibility(rows, _clock.GetUtcNow().UtcDateTime, excludeLoanId);
    }

    public async Task<ApplicationEligibilityDto> GuardApplicationAsync(int customerId, int? excludeLoanId = null)
    {
        // Inside the caller's transaction: serialise every create/reactivate for
        // this customer, then evaluate against committed state. The partial
        // unique index is the DB-level backstop behind this.
        await _uow.Loans.LockCustomerForApplicationAsync(customerId);
        return await CheckApplicationEligibilityAsync(customerId, excludeLoanId);
    }

    private static ApiResponseDto<LoanDto> Blocked(ApplicationEligibilityDto e, int callerUserId, string? callerRole) =>
        ApiResponseDto<LoanDto>.Fail(DescribeEligibilityForCaller(e, callerUserId, callerRole), e.Code!);

    // Salaried = NOT self-employed. Same /SELF|SENP|BUSIN|PROF/ classification as
    // ObligationFoirEngine.IsSelfEmployed (originally the frontend foir.ts
    // isSelfEmployed). Self-employed income is untouched (keeps Perfios-ABB FOIR).
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

    public async Task<ApiResponseDto<LoanDto>> CreateAsync(CreateLoanRequestDto request, int createdByUserId, string? callerRole = null)
    {
        var customer = await _uow.Customers.GetByIdAsync(request.CustomerId);
        if (customer == null) return ApiResponseDto<LoanDto>.Fail("Customer not found.");

        var assigneeError = await ValidateAssigneeAsync(request.AssignedToUserId);
        if (assigneeError != null) return ApiResponseDto<LoanDto>.Fail(assigneeError);

        // Login Team assignee — same exists+active validation, reused via
        // ValidateAssigneeAsync (it's generic: works for any user-id field).
        var loginUserError = await ValidateAssigneeAsync(request.LoginUserId);
        if (loginUserError != null) return ApiResponseDto<LoanDto>.Fail(loginUserError);

        // Duplicate-application + 45-day guard, locked and evaluated in the same
        // transaction as the insert.
        return await _uow.ExecuteInTransactionAsync(async () =>
        {
        var eligibility = await GuardApplicationAsync(request.CustomerId);
        if (!eligibility.Allowed) return Blocked(eligibility, createdByUserId, callerRole);

        var loanNumber = await _uow.Loans.GenerateLoanNumberAsync();
        var emi        = EmiCalculator.ReducingBalance(request.RequestedAmount, request.InterestRate, request.TenureMonths);

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
        });
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
        loan.MonthlyEmi       = EmiCalculator.ReducingBalance(request.RequestedAmount, request.InterestRate, request.TenureMonths);
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

        if (WorkflowOwnedStages.Contains(request.NewStatus))
            return ApiResponseDto<LoanDto>.Fail(
                $"{request.NewStatus} is reached only through the Offers workflow (Move to Offer, Raise Deviation, "
                + "Credit Approval, Disbursement) — it cannot be set directly.", ApiErrorCodes.WorkflowStage);

        var allowed = GetAllowedTransitions(loan.Status);
        if (!allowed.Contains(request.NewStatus))
            return ApiResponseDto<LoanDto>.Fail($"Cannot move from {loan.Status} to {request.NewStatus}.");

        // Deal confirmation (Approved → Acceptance) sends the sanctioned terms to
        // the customer, so it needs an active sanction on record.
        if (request.NewStatus == LoanStatus.Acceptance && _offerHooks != null && !await _offerHooks.HasActiveSanctionAsync(loan.Id))
            return ApiResponseDto<LoanDto>.Fail(
                "Generate the sanction first — deal confirmation needs an active sanction.", ApiErrorCodes.WorkflowStage);
        // …and a completed FI report with no Negative / Pending address (Vanilla
        // _dcFinaliseAcceptance, efin-app.js:34581). Was enforced only by the
        // React dialog, so a direct call could move to Acceptance without it.
        if (request.NewStatus == LoanStatus.Acceptance && _offerHooks != null
            && await _offerHooks.AcceptanceFiBlockerAsync(loan.Id) is { } fiBlocker)
            return ApiResponseDto<LoanDto>.Fail(fiBlocker, ApiErrorCodes.WorkflowStage);

        // Submitting a draft re-runs the duplicate + 45-day guard, so an old
        // draft resumed later cannot slip past a rule that applies today.
        // (No lock needed: the draft itself already occupies the customer's
        // one active slot, so no competing application can be created.)
        if (loan.Status == LoanStatus.Draft && request.NewStatus == LoanStatus.Submitted)
        {
            var eligibility = await CheckApplicationEligibilityAsync(loan.CustomerId, loan.Id);
            if (!eligibility.Allowed) return Blocked(eligibility, changedByUserId, changedByUserRole);
        }

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

            // Owner flow (2026-09-25): Submit → Documents / Income / Bank / ECS
            // checks → Underwriting. The checks were never required here, but the
            // Offer stage requires them and the check actions are offered only up
            // to this point — an application moved early could never reach Offer.
            var checkBlockers = UnderwritingEntryBlockers(loan);
            if (checkBlockers.Count > 0)
                return ApiResponseDto<LoanDto>.Fail(
                    "Cannot move to Under Review — complete the checks first: " + string.Join(", ", checkBlockers) + ".",
                    ApiErrorCodes.WorkflowStage);
        }

        // Disbursement pre-checks (NACH + Customer Agreement, verified InCred
        // callback) now live in DisbursementGateError and are applied by the
        // disbursement-record flow (OfferWorkflowService) — Disbursed is a
        // workflow-owned stage and never reaches this generic path.

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
            loan.MonthlyEmi     = EmiCalculator.ReducingBalance(loan.ApprovedAmount.Value, loan.InterestRate, loan.TenureMonths);
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
            // Downstream cascade: open deviation requests closed, current
            // credit approvals invalidated, active sanction cancelled. Staged
            // on the same context → saved atomically below.
            if (_offerHooks != null)
                await _offerHooks.OnApplicationRejectedAsync(loan.Id, changedByUserId, request.Comment);
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

        return await _uow.ExecuteInTransactionAsync(async () =>
        {
        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");
        if (loan.IsArchived)
            return ApiResponseDto<LoanDto>.Fail(
                "This application is archived. Archived applications cannot be moved to another status.",
                ApiErrorCodes.ApplicationArchived);

        var fromStatus = loan.Status;
        if (fromStatus == newStatus)
            return ApiResponseDto<LoanDto>.Fail($"Loan is already {newStatus}.");

        // The offer chain's stages need their records (offer, deviation request,
        // credit approval, sanction, disbursement) — an override cannot fake them.
        if (WorkflowOwnedStages.Contains(newStatus) || newStatus == LoanStatus.Acceptance)
            return ApiResponseDto<LoanDto>.Fail(
                $"Stage override cannot move an application into {newStatus}; use the Offers workflow.", ApiErrorCodes.WorkflowStage);
        // …nor strand a sanction / disbursement on an application moved out from under it.
        if (_offerHooks != null && newStatus != LoanStatus.Closed && newStatus != LoanStatus.Rejected
            && (await _offerHooks.HasActiveSanctionAsync(loan.Id) || await _offerHooks.HasCompletedDisbursementAsync(loan.Id)))
            return ApiResponseDto<LoanDto>.Fail(
                "This application has an active sanction or a completed disbursement — cancel the sanction / reverse the "
                + "disbursement first.", ApiErrorCodes.WorkflowStage);

        // Moving a closed/rejected application back into an active status is a
        // (re)activation — same duplicate + 45-day guard as a new application.
        if (!IsActiveApplicationStatus(fromStatus) && IsActiveApplicationStatus(newStatus))
        {
            var eligibility = await GuardApplicationAsync(loan.CustomerId, loan.Id);
            if (!eligibility.Allowed) return Blocked(eligibility, changedByUserId, changedByUserRole);
        }

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
            if (_offerHooks != null)
                await _offerHooks.OnApplicationRejectedAsync(loan.Id, changedByUserId, reason);
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
        });
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

        return await _uow.ExecuteInTransactionAsync(async () =>
        {
        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");

        if (loan.IsArchived)
            return ApiResponseDto<LoanDto>.Fail(
                "This application is archived. Archived applications cannot be re-opened.",
                ApiErrorCodes.ApplicationArchived);

        if (loan.Status != LoanStatus.Rejected)
            return ApiResponseDto<LoanDto>.Fail("Only a Rejected application can be re-opened.");

        var daysElapsed = (DateTime.UtcNow - loan.CreatedAt).TotalDays;
        if (daysElapsed > 45)
            return ApiResponseDto<LoanDto>.Fail("Re-open window has expired (45 days from creation date).");

        // Reopening makes this application active again: the customer must not
        // already have another active application, and no OTHER rejection may
        // still be inside its 45-day window. (This application's own rejection
        // is what the admin is reversing, so it is excluded.)
        var eligibility = await GuardApplicationAsync(loan.CustomerId, loan.Id);
        if (!eligibility.Allowed) return Blocked(eligibility, changedByUserId, changedByUserRole);

        var restoreStatus = loan.PreRejectedStatus ?? LoanStatus.Submitted;
        // Downstream revalidation: the rejection closed deviation requests,
        // invalidated the credit approval and cancelled the sanction, so an
        // application rejected at Decision / Approved / Acceptance resumes at
        // Offer and must pass deviation / credit approval / sanction again.
        var resumesAtOffer = restoreStatus is LoanStatus.Decision or LoanStatus.Approved or LoanStatus.Acceptance or LoanStatus.Offer;
        if (resumesAtOffer) restoreStatus = LoanStatus.Offer;
        // Disbursed is never rejectable, so nothing to restore past Acceptance.

        var fromStatus = loan.Status;
        loan.Status              = restoreStatus;
        loan.UpdatedAt           = DateTime.UtcNow;
        loan.SlaBreachNotifiedAt = null;
        loan.PreRejectedStatus   = null;
        // RejectedAt is deliberately KEPT: it is the server-recorded rejection
        // history and is never cleared or edited. It stops counting because the
        // cooldown only applies to applications whose Status is Rejected.

        if (resumesAtOffer && _offerHooks != null)
            await _offerHooks.OnApplicationReopenedAsync(loan.Id, changedByUserId);
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
        });
    }

    // Roles allowed to archive: Admin (Chief Administrator), ProductTeam
    // (Product & Risk Officer), LocationHead (Zonal Manager). Enforced here and
    // by the controller's role gate; the loan must also be inside the caller's
    // normal visibility scope (existing RBAC — HasAccessAsync).
    public static readonly string[] ArchiveRoles = { "Admin", "ProductTeam", "LocationHead" };
    public const int ArchiveReasonMaxLength = 500;

    /// <summary>
    /// Soft, application-level archive. Only a closed/rejected application can be
    /// archived (an active one is refused, so archiving can never be used to get
    /// around the duplicate-application block). Deletes nothing; records who,
    /// when and why on the loan and in the timeline; does not change Status or
    /// RejectedAt, so the 45-day re-application rule is unaffected.
    /// </summary>
    public async Task<ApiResponseDto<LoanDto>> ArchiveAsync(int id, string? reason, int userId, string role)
    {
        if (!ArchiveRoles.Contains(role ?? string.Empty, StringComparer.OrdinalIgnoreCase))
            return ApiResponseDto<LoanDto>.Fail("You do not have permission to archive applications.", ApiErrorCodes.Forbidden);
        if (string.IsNullOrWhiteSpace(reason))
            return ApiResponseDto<LoanDto>.Fail("An archive reason is required.", ApiErrorCodes.ReasonRequired);
        var trimmed = reason.Trim();
        if (trimmed.Length > ArchiveReasonMaxLength)
            return ApiResponseDto<LoanDto>.Fail($"Archive reason must be {ArchiveReasonMaxLength} characters or fewer.", ApiErrorCodes.ReasonRequired);
        if (!await _uow.Loans.HasAccessAsync(id, userId, role!))
            return ApiResponseDto<LoanDto>.Fail("Loan not found.", ApiErrorCodes.NotFound);

        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.", ApiErrorCodes.NotFound);
        if (loan.IsArchived)
            return ApiResponseDto<LoanDto>.Fail("This application is already archived.", ApiErrorCodes.ApplicationArchived);
        if (!IsArchivableStatus(loan.Status))
            return ApiResponseDto<LoanDto>.Fail(
                $"Only closed or rejected applications can be archived. This application is {loan.Status}, " +
                "which is still active/in process.", ApiErrorCodes.ArchiveNotAllowed);

        var now = DateTime.UtcNow;
        loan.IsArchived       = true;
        loan.ArchivedAt       = now;
        loan.ArchivedByUserId = userId;
        loan.ArchiveReason    = trimmed;
        loan.UpdatedAt        = now;
        await _uow.Loans.UpdateAsync(loan);

        // Timeline entry (same-status row, like UpdateLenderRmAsync) so the
        // archive is visible in the application's history. Rejected→Rejected is
        // never read as a rejection by the eligibility guard.
        await _uow.LoanStatusHistories.AddAsync(new LoanStatusHistory
        {
            LoanId          = loan.Id,
            FromStatus      = loan.Status,
            ToStatus        = loan.Status,
            Comment         = $"[ARCHIVED] {trimmed}",
            ChangedByUserId = userId
        });
        // Status is the concurrency token: if someone changed the status
        // meanwhile this save fails with 409 instead of archiving a loan that
        // is no longer closed/rejected.
        await _uow.SaveChangesAsync();

        var updated = await _uow.Loans.GetWithDetailsAsync(id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"), "Application archived.");
    }

    // States from which a loan may be put on hold. Draft (not yet submitted),
    // and the terminal/locked states (Rejected/Disbursed/Closed) cannot —
    // matching legacy's EDIT_BLOCKED/FINAL_LOCK stages. Hold is for pausing an
    // in-flight application; Offer and Decision are in-flight too.
    private static readonly HashSet<LoanStatus> _holdableStates = new()
    {
        LoanStatus.Submitted, LoanStatus.UnderReview, LoanStatus.Offer, LoanStatus.Decision,
        LoanStatus.Approved, LoanStatus.Acceptance
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
        if (_offerHooks != null) await _offerHooks.OnApplicationHeldAsync(loan.Id, reason);
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
        if (_offerHooks != null) await _offerHooks.OnApplicationUnheldAsync(loan.Id);
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

    // The former hard-coded DeviationEvaluator (GetDeviationsAsync) and the
    // loan-level Raise / Decide / Skip deviation path were replaced by the
    // lender-specific, rule-driven, offer-level deviation workflow
    // (DeviationRuleEngine + OfferWorkflowService). Deviation approval is no
    // longer credit approval, and a rejected deviation no longer rejects the
    // application.

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
        // SECURITY (Phase 5, vuln S1): IncomeChecked is NO LONGER client-settable
        // here. It is now DERIVED solely from an authoritative IncomeVerification
        // run (IncomeVerificationService), so a browser can never mark income
        // "verified" by PATCHing this flag. The request field is intentionally
        // ignored; income completion flows through /income-verification/run.
        // (The column itself is kept for DB/back-compat, per §11.)
        //
        // The other verification flags follow the same principle: the server sets
        // them when the check is recorded (POST /tracking, see VerificationChecks).
        // A browser could previously assert any of them here with no recorded
        // check and at any stage — so "done" is accepted only when the matching
        // Timeline entry exists and the application is in that check's stage
        // window, and nothing changes on a held / closed application.
        foreach (var (value, check) in new (bool?, VerificationChecks.Check)[]
                 {
                     (request.DocumentChecked, VerificationChecks.Documents),
                     (request.BankChecked, VerificationChecks.Bank),
                     (request.EcsReturn, VerificationChecks.Ecs),
                     (request.FiReportChecked, VerificationChecks.FiReport),
                     (request.NachDone, VerificationChecks.Nach),
                     (request.CustomerAgreementDone, VerificationChecks.Agreement),
                 })
        {
            if (value is not bool wanted || check.Get(loan) == wanted) continue;
            if (VerificationChecks.IsFrozen(loan.Status))
                return ApiResponseDto<LoanDto>.Fail(
                    $"Verification checks cannot be changed on a {loan.Status} application.", ApiErrorCodes.WorkflowStage);
            if (wanted)
            {
                if (!check.Stages.Contains(loan.Status))
                    return ApiResponseDto<LoanDto>.Fail(
                        $"The {check.Label} can be recorded only at {VerificationChecks.StageList(check)} (this application is {loan.Status}).",
                        ApiErrorCodes.WorkflowStage);
                if (_offerHooks != null && !await _offerHooks.HasTimelineEntryAsync(loan.Id, check.EntryName))
                    return ApiResponseDto<LoanDto>.Fail(
                        $"Record the {check.Label} first — it is marked done when the check is recorded on the Timeline.",
                        ApiErrorCodes.WorkflowStage);
            }
            check.Set(loan, wanted);
        }

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

        // Manager may delete another user's draft only inside its own
        // visibility scope (Location AND Team) — the same rule that decides
        // whether it can see the loan at all. Admin stays unscoped.
        if (isInternal && loan.CreatedByUserId != currentUserId &&
            !string.Equals(currentUserRole, "Admin", StringComparison.OrdinalIgnoreCase) &&
            !await _uow.Loans.HasAccessAsync(id, currentUserId, currentUserRole))
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

    // Generic (status-route / bulk) transitions. The offer chain's stages
    // (Offer, Decision, Approved, Disbursed — WorkflowOwnedStages) are entered
    // only through OfferWorkflowService; from them the generic path may only
    // Reject (and Approved → Acceptance for deal confirmation, which needs an
    // active sanction; Disbursed → Closed).
    private static List<LoanStatus> GetAllowedTransitions(LoanStatus current) => current switch
    {
        LoanStatus.Draft       => new() { LoanStatus.Submitted, LoanStatus.Rejected },
        LoanStatus.Submitted   => new() { LoanStatus.UnderReview, LoanStatus.Rejected },
        LoanStatus.UnderReview => new() { LoanStatus.Rejected },
        LoanStatus.Offer       => new() { LoanStatus.Rejected },
        LoanStatus.Decision    => new() { LoanStatus.Rejected },
        LoanStatus.Approved    => new() { LoanStatus.Acceptance, LoanStatus.Rejected },
        LoanStatus.Acceptance  => new() { LoanStatus.Rejected },
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
            IsArchived     = l.IsArchived,
            ArchivedAt     = l.ArchivedAt,
            ArchivedByName = l.ArchivedBy?.FullName,
            ArchiveReason  = l.ArchiveReason,
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
