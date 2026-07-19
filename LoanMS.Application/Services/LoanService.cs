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

    public async Task<ApiResponseDto<LoanDto>> GetByIdAsync(int id, string callerRole = "Sales")
    {
        var loan = await _uow.Loans.GetWithDetailsAsync(id);
        if (loan == null) return ApiResponseDto<LoanDto>.Fail("Loan not found.");
        return ApiResponseDto<LoanDto>.Ok(MapToDto(loan, callerRole));
    }

    public async Task<ApiResponseDto<PagedResultDto<LoanListDto>>> GetAllAsync(LoanFilterDto filter, int currentUserId, string currentUserRole)
    {
        // Cache simple unfiltered page requests (30s TTL)
        // Complex filters (search, date range) bypass cache for accuracy
        var hasComplexFilter = !string.IsNullOrEmpty(filter.Search)
            || filter.FromDate.HasValue || filter.ToDate.HasValue;

        if (!hasComplexFilter)
        {
            var cacheKey = $"loans:list:{filter.Status}:{filter.LoanType}:{filter.Page}:{filter.PageSize}:{currentUserId}:{currentUserRole}";
            var cached   = await _cache.GetAsync<PagedResultDto<LoanListDto>>(cacheKey);
            if (cached != null) return ApiResponseDto<PagedResultDto<LoanListDto>>.Ok(cached);

            var result = await _uow.Loans.GetPagedAsync(filter, currentUserId, currentUserRole);
            await _cache.SetAsync(cacheKey, result, TimeSpan.FromSeconds(30));
            return ApiResponseDto<PagedResultDto<LoanListDto>>.Ok(result);
        }

        var searchResult = await _uow.Loans.GetPagedAsync(filter, currentUserId, currentUserRole);
        return ApiResponseDto<PagedResultDto<LoanListDto>>.Ok(searchResult);
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

        var created = await _uow.Loans.GetWithDetailsAsync(loan.Id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(created!, "Admin"), "Loan created successfully.");
    }

    public async Task<ApiResponseDto<LoanDto>> UpdateAsync(int id, UpdateLoanRequestDto request)
    {
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

        var updated = await _uow.Loans.GetWithDetailsAsync(id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"), "Loan updated.");
    }

    public async Task<ApiResponseDto<LoanDto>> UpdateStatusAsync(int id, UpdateLoanStatusRequestDto request, int changedByUserId)
    {
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
        await _cache.RemoveByPrefixAsync("dashboard:"); // Invalidate dashboard cache

        var updated = await _uow.Loans.GetWithDetailsAsync(id);
        return ApiResponseDto<LoanDto>.Ok(MapToDto(updated!, "Admin"), $"Loan status updated to {request.NewStatus}.");
    }

    public async Task<ApiResponseDto<bool>> DeleteAsync(int id)
    {
        var loan = await _uow.Loans.GetByIdAsync(id);
        if (loan == null) return ApiResponseDto<bool>.Fail("Loan not found.");
        if (loan.Status != LoanStatus.Draft)
            return ApiResponseDto<bool>.Fail("Only Draft loans can be deleted.");

        await _uow.Loans.DeleteAsync(id);
        await _uow.SaveChangesAsync();
        return ApiResponseDto<bool>.Ok(true, "Loan deleted.");
    }

    public async Task<ApiResponseDto<DashboardStatsDto>> GetDashboardStatsAsync(int userId, string role)
    {
        var cacheKey = $"dashboard:{userId}:{role}";
        var cached = await _cache.GetAsync<DashboardStatsDto>(cacheKey);
        if (cached != null) return ApiResponseDto<DashboardStatsDto>.Ok(cached);

        var stats = await _uow.Loans.GetDashboardStatsAsync(userId, role);
        await _cache.SetAsync(cacheKey, stats, TimeSpan.FromSeconds(60));
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
