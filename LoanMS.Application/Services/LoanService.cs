using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;

namespace LoanMS.Application.Services;

public class LoanService : ILoanService
{
    private readonly IUnitOfWork   _uow;
    private readonly ICacheService _cache;

    public LoanService(IUnitOfWork uow, ICacheService cache)
    {
        _uow   = uow;
        _cache = cache;
    }

    // Roles that may see internal routing data (Remarks field contains lender/channel/source).
    private static readonly HashSet<string> _internalRoles =
        new(StringComparer.OrdinalIgnoreCase) { "Admin", "Manager" };

    // Roles that receive unmasked PII inside embedded CustomerDto.
    private static readonly HashSet<string> _elevatedRoles =
        new(StringComparer.OrdinalIgnoreCase) { "Admin", "Manager" };

    public async Task<ApiResponseDto<LoanDto>> GetByIdAsync(int id, int currentUserId, string callerRole = "Sales")
    {
        // Phase 2B — role-based visibility is enforced at the repository query
        // level, not after the fact. If the loan exists but falls outside the
        // caller's scope (e.g. someone swaps the loanId in the URL), this comes
        // back null the same way a genuinely missing loan would — no distinction
        // is leaked between "doesn't exist" and "not yours to see".
        var loan = await _uow.Loans.GetWithDetailsAsync(id, currentUserId, callerRole);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");
        return ApiResponseDto<LoanDto>.Ok(MapToDto(loan, callerRole));
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

    public async Task<ApiResponseDto<LoanDto>> CreateAsync(CreateLoanRequestDto request, int createdByUserId)
    {
        var customer = await _uow.Customers.GetByIdAsync(request.CustomerId);
        if (customer == null) return ApiResponseDto<LoanDto>.Fail("Customer not found.");

        if (request.AssignedToUserId.HasValue)
        {
            var assignee = await _uow.Users.GetByIdAsync(request.AssignedToUserId.Value);
            if (assignee == null) return ApiResponseDto<LoanDto>.Fail("Assigned user not found.");
        }

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
            AssignedToUserId = request.AssignedToUserId
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

        loan.LoanType         = request.LoanType;
        loan.RequestedAmount  = request.RequestedAmount;
        loan.InterestRate     = request.InterestRate;
        loan.TenureMonths     = request.TenureMonths;
        loan.MonthlyEmi       = CalculateEmi(request.RequestedAmount, request.InterestRate, request.TenureMonths);
        loan.Purpose          = request.Purpose;
        loan.Remarks          = request.Remarks;
        loan.AssignedToUserId = request.AssignedToUserId;
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
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"), $"Loan status updated to {request.NewStatus}.");
    }

    public async Task<ApiResponseDto<bool>> DeleteAsync(int id, int currentUserId, string currentUserRole)
    {
        // Phase 3A — Delete is already Admin-only at the controller (Role
        // attribute), and Admin is unrestricted in ApplyVisibilityScope, so this
        // check is a no-op for Admin today. Kept here for defense-in-depth and so
        // Delete follows the same "verify access before acting" pattern as every
        // other action, in case the allowed-roles list ever changes.
        if (!await _uow.Loans.HasAccessAsync(id, currentUserId, currentUserRole))
            return ApiResponseDto<bool>.Fail("Loan not found.");

        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<bool>.Fail("Loan not found.");
        if (loan.Status != LoanStatus.Draft)
            return ApiResponseDto<bool>.Fail("Only Draft loans can be deleted.");

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

    internal static LoanDto MapToDto(Loan l, string callerRole = "Sales")
    {
        var isInternal = _internalRoles.Contains(callerRole);
        var isElevated = _elevatedRoles.Contains(callerRole);

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
                CibilScore    = l.Customer.CibilScore
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
