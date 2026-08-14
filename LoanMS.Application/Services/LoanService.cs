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

    public LoanService(IUnitOfWork uow, ICacheService cache, IEmailService emailService, IEmailTemplateProvider emailTemplates)
    {
        _uow   = uow;
        _cache = cache;
        _emailService = emailService;
        _emailTemplates = emailTemplates;
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

        await _uow.LoanStatusHistories.AddAsync(new LoanStatusHistory
        {
            LoanId           = loan.Id,
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
            .Select(r => new LoanReference { Name = r.Name!, Mobile = r.Mobile ?? string.Empty, Relation = r.Relation ?? string.Empty, RefNumber = r.RefNumber })
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
        LoanStatus.Approved    => new() { LoanStatus.Disbursed, LoanStatus.Rejected },
        LoanStatus.Disbursed   => new() { LoanStatus.Closed },
        _                      => new()
    };

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
                Address            = hideAddress    ? null : l.Customer.Address,
                City               = hideAddress    ? null : l.Customer.City,
                State              = hideAddress    ? null : l.Customer.State,
                PinCode            = hideAddress    ? null : l.Customer.PinCode,
                ResidenceType      = hideAddress    ? null : l.Customer.ResidenceType,
                MonthlyIncome      = hideEmployment ? null : l.Customer.MonthlyIncome,
                MonthlyObligations = hideEmployment ? null : l.Customer.MonthlyObligations,
                EmploymentType     = hideEmployment ? null : l.Customer.EmploymentType,
                CompanyName        = hideEmployment ? null : l.Customer.CompanyName,
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
                    { Id = r.Id, Name = r.Name, Mobile = r.Mobile, Relation = r.Relation, RefNumber = r.RefNumber }).ToList() ?? new(),
            SanctionDetail = l.SanctionDetail == null ? null : new LoanSanctionDetailDto
            {
                StampDuty = l.SanctionDetail.StampDuty, Gst = l.SanctionDetail.Gst,
                Insurance = l.SanctionDetail.Insurance, PfPercent = l.SanctionDetail.PfPercent,
                InsuranceInBundled = l.SanctionDetail.InsuranceInBundled, PfInBundled = l.SanctionDetail.PfInBundled,
                IsBundled = l.SanctionDetail.IsBundled, IsBt = l.SanctionDetail.IsBt,
                FlatRate = l.SanctionDetail.FlatRate, EmiDate = l.SanctionDetail.EmiDate
            },
            ProductDataJson = l.ProductDataJson,
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
