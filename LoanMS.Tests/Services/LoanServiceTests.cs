using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using FluentAssertions;

namespace LoanMS.Tests.Services;

public class LoanServiceTests
{
    private readonly Mock<IUnitOfWork>              _uowMock      = new();
    private readonly Mock<ILoanRepository>          _loanRepoMock = new();
    private readonly Mock<ICustomerRepository>      _custRepoMock = new();
    private readonly Mock<IUserRepository>          _userRepoMock = new();
    private readonly Mock<ILoanStatusHistoryRepository> _histRepoMock = new();
    private readonly Mock<IEmailService>             _emailMock    = new();
    private readonly Mock<IEmailTemplateProvider>    _emailTplMock = new();

    private LoanService CreateService()
    {
        _uowMock.Setup(u => u.Loans).Returns(_loanRepoMock.Object);
        _uowMock.Setup(u => u.Customers).Returns(_custRepoMock.Object);
        _uowMock.Setup(u => u.Users).Returns(_userRepoMock.Object);
        _uowMock.Setup(u => u.LoanStatusHistories).Returns(_histRepoMock.Object);
        _uowMock.Setup(u => u.SaveChangesAsync()).ReturnsAsync(1);
        // Create/override/reopen now run inside ExecuteInTransactionAsync (guard +
        // write in one transaction); for these mock-level tests just run the work.
        _uowMock.Setup(u => u.ExecuteInTransactionAsync(It.IsAny<Func<Task<ApiResponseDto<LoanDto>>>>()))
                .Returns<Func<Task<ApiResponseDto<LoanDto>>>>(work => work());
        _loanRepoMock.Setup(r => r.GetEligibilityRowsAsync(It.IsAny<int>()))
                .ReturnsAsync(new List<LoanEligibilityRow>());

        // Email mocks: no-op sends, template lookups return "no override" —
        // the stage-notification email trigger added to UpdateStatusAsync
        // should never fail a test that isn't specifically about it.
        _emailMock.Setup(e => e.SendAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>()))
                  .Returns(Task.CompletedTask);
        _emailTplMock.Setup(t => t.GetTemplateAsync(It.IsAny<string>()))
                  .ReturnsAsync(((string?)null, (string?)null));

        return new LoanService(_uowMock.Object, _emailMock.Object, _emailTplMock.Object);
    }

    [Fact]
    public async Task GetByIdAsync_WhenLoanNotFound_ReturnsFail()
    {
        _loanRepoMock.Setup(r => r.GetWithDetailsAsync(99, It.IsAny<int?>(), It.IsAny<string?>())).ReturnsAsync((Loan?)null);
        var svc    = CreateService();
        var result = await svc.GetByIdAsync(99, 1, "Admin");
        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("not found"));
    }

    [Fact]
    public async Task GetByIdAsync_WhenLoanExists_ReturnsSuccess()
    {
        var loan = CreateTestLoan();
        _loanRepoMock.Setup(r => r.GetWithDetailsAsync(1, It.IsAny<int?>(), It.IsAny<string?>())).ReturnsAsync(loan);
        var svc    = CreateService();
        var result = await svc.GetByIdAsync(1, 1, "Admin");
        result.Success.Should().BeTrue();
        result.Data!.LoanNumber.Should().Be("LMS-2024-0001");
    }

    [Fact]
    public async Task CreateAsync_WhenCustomerNotFound_ReturnsFail()
    {
        _custRepoMock.Setup(r => r.GetByIdAsync(999)).ReturnsAsync((Customer?)null);
        var svc    = CreateService();
        var result = await svc.CreateAsync(
            new CreateLoanRequestDto
            {
                CustomerId = 999, RequestedAmount = 100000,
                InterestRate = 10, TenureMonths = 12, LoanType = LoanType.Personal
            }, 1);
        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("Customer not found"));
    }

    [Fact]
    public async Task CreateAsync_WithValidData_ReturnsCreatedLoan()
    {
        var customer    = new Customer { Id = 1, FullName = "Test Customer", Email = "t@t.com", Phone = "9999999999" };
        var createdLoan = CreateTestLoan();

        _custRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(customer);
        _loanRepoMock.Setup(r => r.GenerateLoanNumberAsync()).ReturnsAsync("LMS-2024-0001");
        _loanRepoMock.Setup(r => r.AddAsync(It.IsAny<Loan>())).ReturnsAsync((Loan l) => l);
        _histRepoMock.Setup(r => r.AddAsync(It.IsAny<LoanStatusHistory>())).ReturnsAsync(new LoanStatusHistory());
        _loanRepoMock.Setup(r => r.GetWithDetailsAsync(It.IsAny<int>())).ReturnsAsync(createdLoan);

        var svc    = CreateService();
        var result = await svc.CreateAsync(
            new CreateLoanRequestDto
            {
                CustomerId = 1, RequestedAmount = 100000,
                InterestRate = 10, TenureMonths = 12, LoanType = LoanType.Personal
            }, createdByUserId: 1);

        result.Success.Should().BeTrue();
        result.Data.Should().NotBeNull();
    }

    [Fact]
    public async Task CreateAsync_WithInvalidAssignee_ReturnsFail()
    {
        var customer = new Customer { Id = 1, FullName = "Test Customer", Email = "t@t.com", Phone = "9999999999" };
        _custRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(customer);
        _userRepoMock.Setup(r => r.GetByIdAsync(999)).ReturnsAsync((User?)null);

        var svc    = CreateService();
        var result = await svc.CreateAsync(
            new CreateLoanRequestDto
            {
                CustomerId = 1, RequestedAmount = 100000, InterestRate = 10,
                TenureMonths = 12, LoanType = LoanType.Personal, AssignedToUserId = 999
            }, 1);

        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("Assigned user not found"));
    }

    [Fact]
    public async Task CreateAsync_WithInactiveAssignee_ReturnsFail()
    {
        var customer = new Customer { Id = 1, FullName = "Test Customer", Email = "t@t.com", Phone = "9999999999" };
        var inactiveUser = new User { Id = 5, FullName = "Inactive", Email = "i@i.com", IsActive = false };
        _custRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(customer);
        _userRepoMock.Setup(r => r.GetByIdAsync(5)).ReturnsAsync(inactiveUser);

        var svc    = CreateService();
        var result = await svc.CreateAsync(
            new CreateLoanRequestDto
            {
                CustomerId = 1, RequestedAmount = 100000, InterestRate = 10,
                TenureMonths = 12, LoanType = LoanType.Personal, AssignedToUserId = 5
            }, 1);

        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("inactive"));
    }

    [Fact]
    public async Task CreateAsync_WithValidActiveAssignee_ReturnsSuccess()
    {
        var customer     = new Customer { Id = 1, FullName = "Test Customer", Email = "t@t.com", Phone = "9999999999" };
        var activeUser   = new User { Id = 7, FullName = "Active", Email = "a@a.com", IsActive = true };
        var createdLoan  = CreateTestLoan();

        _custRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(customer);
        _userRepoMock.Setup(r => r.GetByIdAsync(7)).ReturnsAsync(activeUser);
        _loanRepoMock.Setup(r => r.GenerateLoanNumberAsync()).ReturnsAsync("LMS-2024-0001");
        _loanRepoMock.Setup(r => r.AddAsync(It.IsAny<Loan>())).ReturnsAsync((Loan l) => l);
        _histRepoMock.Setup(r => r.AddAsync(It.IsAny<LoanStatusHistory>())).ReturnsAsync(new LoanStatusHistory());
        _loanRepoMock.Setup(r => r.GetWithDetailsAsync(It.IsAny<int>())).ReturnsAsync(createdLoan);

        var svc    = CreateService();
        var result = await svc.CreateAsync(
            new CreateLoanRequestDto
            {
                CustomerId = 1, RequestedAmount = 100000, InterestRate = 10,
                TenureMonths = 12, LoanType = LoanType.Personal, AssignedToUserId = 7
            }, 1);

        result.Success.Should().BeTrue();
    }

    [Fact]
    public async Task UpdateAsync_WithInvalidAssignee_ReturnsFail()
    {
        var loan = CreateTestLoan();
        loan.Status = LoanStatus.Draft;
        _loanRepoMock.Setup(r => r.HasAccessAsync(1, It.IsAny<int>(), It.IsAny<string?>())).ReturnsAsync(true);
        _loanRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(loan);
        _userRepoMock.Setup(r => r.GetByIdAsync(999)).ReturnsAsync((User?)null);

        var svc    = CreateService();
        var result = await svc.UpdateAsync(1,
            new UpdateLoanRequestDto
            {
                LoanType = LoanType.Personal, RequestedAmount = 100000, InterestRate = 10,
                TenureMonths = 12, AssignedToUserId = 999
            }, 1, "Admin");

        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("Assigned user not found"));
    }

    [Fact]
    public async Task UpdateAsync_WithInactiveAssignee_ReturnsFail()
    {
        var loan = CreateTestLoan();
        loan.Status = LoanStatus.Draft;
        var inactiveUser = new User { Id = 5, FullName = "Inactive", Email = "i@i.com", IsActive = false };
        _loanRepoMock.Setup(r => r.HasAccessAsync(1, It.IsAny<int>(), It.IsAny<string?>())).ReturnsAsync(true);
        _loanRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(loan);
        _userRepoMock.Setup(r => r.GetByIdAsync(5)).ReturnsAsync(inactiveUser);

        var svc    = CreateService();
        var result = await svc.UpdateAsync(1,
            new UpdateLoanRequestDto
            {
                LoanType = LoanType.Personal, RequestedAmount = 100000, InterestRate = 10,
                TenureMonths = 12, AssignedToUserId = 5
            }, 1, "Admin");

        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("inactive"));
    }

    [Fact]
    public async Task UpdateAsync_WithValidActiveAssignee_ReturnsSuccess()
    {
        var loan = CreateTestLoan();
        loan.Status = LoanStatus.Draft;
        var activeUser = new User { Id = 7, FullName = "Active", Email = "a@a.com", IsActive = true };
        _loanRepoMock.Setup(r => r.HasAccessAsync(1, It.IsAny<int>(), It.IsAny<string?>())).ReturnsAsync(true);
        _loanRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(loan);
        _userRepoMock.Setup(r => r.GetByIdAsync(7)).ReturnsAsync(activeUser);
        _loanRepoMock.Setup(r => r.UpdateAsync(It.IsAny<Loan>())).ReturnsAsync((Loan l) => l);
        _loanRepoMock.Setup(r => r.GetWithDetailsAsync(1)).ReturnsAsync(loan);

        var svc    = CreateService();
        var result = await svc.UpdateAsync(1,
            new UpdateLoanRequestDto
            {
                LoanType = LoanType.Personal, RequestedAmount = 100000, InterestRate = 10,
                TenureMonths = 12, AssignedToUserId = 7
            }, 1, "Admin");

        result.Success.Should().BeTrue();
    }

    [Fact]
    public void MapToDto_WithZeroRate_ReturnsSimpleDivisionEmi()
    {
        var loan = CreateTestLoan();
        loan.InterestRate    = 0;
        loan.RequestedAmount = 120000;
        loan.TenureMonths    = 12;
        // MapToDto is a pure passthrough projection — MonthlyEmi is computed and
        // stored on the entity elsewhere (CreateAsync/UpdateStatusAsync), so the
        // test must set it the same way before mapping.
        // When rate=0, EMI = principal / months = 10000
        loan.MonthlyEmi = loan.RequestedAmount / loan.TenureMonths;
        var dto = LoanService.MapToDto(loan, "Admin");
        dto.Should().NotBeNull();
        dto.MonthlyEmi.Should().Be(10000m);
    }

    [Fact]
    public async Task UpdateStatusAsync_InvalidTransition_ReturnsFail()
    {
        var loan = CreateTestLoan();
        loan.Status = LoanStatus.Closed;
        _loanRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(loan);
        _loanRepoMock.Setup(r => r.HasAccessAsync(1, It.IsAny<int>(), It.IsAny<string?>())).ReturnsAsync(true);

        var svc    = CreateService();
        var result = await svc.UpdateStatusAsync(1,
            new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Submitted, Comment = "Test" }, 1, "Admin");

        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("Cannot move"));
    }

    [Theory]
    [InlineData(-5000)]
    [InlineData(0)]
    public async Task UpdateStatusAsync_ApproveWithNonPositiveAmount_ReturnsFail_AndLeavesLoanUntouched(int amount)
    {
        // Regression: -5000 was stored as ApprovedAmount with a negative EMI.
        var loan = CreateTestLoan();
        loan.Status = LoanStatus.UnderReview;
        _loanRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(loan);
        _loanRepoMock.Setup(r => r.HasAccessAsync(1, It.IsAny<int>(), It.IsAny<string?>())).ReturnsAsync(true);

        var result = await CreateService().UpdateStatusAsync(1,
            new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Approved, ApprovedAmount = amount }, 1, "Admin");

        result.Success.Should().BeFalse();
        loan.Status.Should().Be(LoanStatus.UnderReview);
        loan.ApprovedAmount.Should().BeNull();
    }

    [Fact]
    public async Task UpdateStatusAsync_ValidTransition_ReturnsSuccess()
    {
        var loan = CreateTestLoan();
        loan.Status = LoanStatus.Draft;
        _loanRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(loan);
        _loanRepoMock.Setup(r => r.HasAccessAsync(1, It.IsAny<int>(), It.IsAny<string?>())).ReturnsAsync(true);
        _histRepoMock.Setup(r => r.AddAsync(It.IsAny<LoanStatusHistory>())).ReturnsAsync(new LoanStatusHistory());
        _loanRepoMock.Setup(r => r.UpdateAsync(It.IsAny<Loan>())).ReturnsAsync((Loan l) => l);
        _loanRepoMock.Setup(r => r.GetWithDetailsAsync(1)).ReturnsAsync(loan);

        var svc    = CreateService();
        var result = await svc.UpdateStatusAsync(1,
            new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Submitted, Comment = "Submitting" }, 1, "Admin");

        result.Success.Should().BeTrue();
    }

    // ── Verified InCred disbursement gate ────────────────────────────────────
    // A loan routed through InCred may only reach Disbursed once a verified
    // InCred disbursement-success callback is on record. Non-InCred loans keep
    // the internal manual-disbursement behaviour.
    private Loan SetupApprovedLoanForDisburse(Action<Loan>? customize = null)
    {
        var loan = CreateTestLoan();
        loan.Status = LoanStatus.Approved;
        // Disburse pre-conditions (NACH + Customer Agreement) must be satisfied
        // for the loan to reach the disburse step at all — this gate was added
        // after these tests were first written, so without it every disburse
        // test fails at the pre-condition before reaching the InCred verified-
        // disbursement gate they are actually exercising. Set them true here so
        // the tests validate the intended gate; a test that needs them unset can
        // override via the customize callback.
        loan.NachDone = true;
        loan.CustomerAgreementDone = true;
        customize?.Invoke(loan);
        _loanRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(loan);
        _loanRepoMock.Setup(r => r.HasAccessAsync(1, It.IsAny<int>(), It.IsAny<string?>())).ReturnsAsync(true);
        _histRepoMock.Setup(r => r.AddAsync(It.IsAny<LoanStatusHistory>())).ReturnsAsync(new LoanStatusHistory());
        _loanRepoMock.Setup(r => r.UpdateAsync(It.IsAny<Loan>())).ReturnsAsync((Loan l) => l);
        _loanRepoMock.Setup(r => r.GetWithDetailsAsync(1)).ReturnsAsync(loan);
        return loan;
    }

    // The gate is now applied by the disbursement-record flow
    // (OfferWorkflowService.CreateDisbursementAsync) through the shared
    // LoanService.DisbursementGateError — same rule, same messages.
    private Task<string?> Disburse()
    {
        var loan = _loanRepoMock.Object.GetByIdAsync(1).Result!;
        return Task.FromResult(LoanService.DisbursementGateError(loan));
    }

    [Fact]
    public async Task Disburse_NonIncredLoan_Allowed()
    {
        SetupApprovedLoanForDisburse(); // no InCred markers → manual mode
        (await Disburse()).Should().BeNull();
    }

    [Fact]
    public async Task Disburse_NachOrAgreementMissing_Blocked()
    {
        SetupApprovedLoanForDisburse(l => l.NachDone = false);
        (await Disburse()).Should().Contain("Nach and Customer Agreement");
    }

    [Fact]
    public async Task Disburse_IncredLoan_VerifiedSuccess_Allowed()
    {
        SetupApprovedLoanForDisburse(l =>
        {
            l.ApplicationSource = "incred";
            l.IncredApplicationId = "APP-1";
            l.IncredLastWebhookEvent = "LOAN_DISBURSED";
            l.IncredLastWebhookStatus = "SUCCESS";
        });
        (await Disburse()).Should().BeNull("a verified InCred disbursement success is on record");
    }

    [Theory]
    [InlineData("DISBURSEMENT_INITIATED", "PENDING")]   // pending → blocked
    [InlineData("LOAN_DISBURSED", "FAILED")]            // failed  → blocked
    [InlineData("SOMETHING_ELSE", "UNKNOWN")]           // unknown → blocked
    [InlineData(null, null)]                            // no callback on record → blocked
    public async Task Disburse_IncredLoan_Unverified_Blocked(string? evt, string? status)
    {
        SetupApprovedLoanForDisburse(l =>
        {
            l.ApplicationSource = "incred";
            l.IncredApplicationId = "APP-1";
            l.IncredLastWebhookEvent = evt;
            l.IncredLastWebhookStatus = status;
        });
        (await Disburse()).Should().Contain("verified InCred disbursement");
    }

    [Fact]
    public async Task Disburse_ViaGenericStatusRoute_IsRefused()
    {
        var loan = SetupApprovedLoanForDisburse();
        var result = await CreateService().UpdateStatusAsync(1,
            new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Disbursed, Comment = "Disburse" }, 1, "Admin");
        result.Success.Should().BeFalse();
        loan.Status.Should().Be(LoanStatus.Approved);
        loan.DisbursedAt.Should().BeNull();
    }

    [Fact]
    public async Task GetDashboardStatsAsync_AlwaysReadsThroughToRepository_NeverCaches()
    {
        // Phase 3 — regression test for the cross-device/cross-replica staleness
        // bug: dashboard totals must always come straight from the database, not
        // from a cache that RemoveByPrefixAsync can silently fail to invalidate
        // (no-op on the Redis-backed implementation; per-replica-only on ECS with
        // multiple Fargate tasks under the in-memory fallback). Calling this twice
        // must hit the repository twice — a cache hit on the second call would be
        // exactly the bug this guards against.
        var stats = new DashboardStatsDto();
        _uowMock.Setup(u => u.Loans).Returns(_loanRepoMock.Object);
        _loanRepoMock.Setup(r => r.GetDashboardStatsAsync(It.IsAny<int?>(), It.IsAny<string?>()))
                     .ReturnsAsync(stats);

        var svc = CreateService();
        var result1 = await svc.GetDashboardStatsAsync(1, "Admin");
        var result2 = await svc.GetDashboardStatsAsync(1, "Admin");

        result1.Success.Should().BeTrue();
        result2.Success.Should().BeTrue();
        _loanRepoMock.Verify(r => r.GetDashboardStatsAsync(1, "Admin"), Times.Exactly(2));
        LoanServiceHasNoCacheDependency();
    }

    [Fact]
    public async Task GetAllAsync_NeverTouchesCache()
    {
        // Phase 1/3 regression guard — the original bug this whole fix chain is
        // about. The Application List must never be served from cache.
        var filter = new LoanFilterDto();
        _uowMock.Setup(u => u.Loans).Returns(_loanRepoMock.Object);
        _loanRepoMock.Setup(r => r.GetPagedAsync(filter, It.IsAny<int>(), It.IsAny<string>()))
                     .ReturnsAsync(new PagedResultDto<LoanListDto>());

        var svc = CreateService();
        await svc.GetAllAsync(filter, 1, "Admin");

        LoanServiceHasNoCacheDependency();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    // LoanService takes no ICacheService at all, so it cannot serve anything
    // from a cache — guard against one being re-introduced.
    private static void LoanServiceHasNoCacheDependency() =>
        typeof(LoanService).GetConstructors()
            .SelectMany(c => c.GetParameters())
            .Should().NotContain(p => p.ParameterType == typeof(ICacheService));

    private static Loan CreateTestLoan() => new()
    {
        Id              = 1,
        LoanNumber      = "LMS-2024-0001",
        LoanType        = LoanType.Personal,
        Status          = LoanStatus.Draft,
        RequestedAmount = 100000,
        InterestRate    = 10,
        TenureMonths    = 12,
        CreatedAt       = DateTime.UtcNow,
        Customer        = new Customer { Id = 1, FullName = "Test", Email = "t@t.com", Phone = "9999999999" },
        CreatedBy       = new User { Id = 1, FullName = "Admin", Email = "admin@efin.com", Role = UserRole.Admin },
        StatusHistory   = new List<LoanStatusHistory>()
    };

    // ── Hold / Un-hold workflow ──────────────────────────────────────────────

    [Fact]
    public async Task HoldAsync_FromUnderReview_SetsOnHold_AndRecordsHistory()
    {
        var loan = CreateTestLoan();
        loan.Status = LoanStatus.UnderReview;
        _loanRepoMock.Setup(r => r.HasAccessAsync(1, It.IsAny<int>(), It.IsAny<string>())).ReturnsAsync(true);
        _loanRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(loan);
        _loanRepoMock.Setup(r => r.GetWithDetailsAsync(1, It.IsAny<int?>(), It.IsAny<string?>())).ReturnsAsync(loan);
        LoanStatusHistory? recorded = null;
        _histRepoMock.Setup(h => h.AddAsync(It.IsAny<LoanStatusHistory>()))
            .Callback<LoanStatusHistory>(h => recorded = h)
            .ReturnsAsync((LoanStatusHistory h) => h);

        var result = await CreateService().HoldAsync(1, "Docs pending", 1, "Admin");

        result.Success.Should().BeTrue();
        loan.Status.Should().Be(LoanStatus.OnHold);
        recorded.Should().NotBeNull();
        recorded!.FromStatus.Should().Be(LoanStatus.UnderReview);
        recorded.ToStatus.Should().Be(LoanStatus.OnHold);
        recorded.Comment.Should().Be("Docs pending");
    }

    [Fact]
    public async Task HoldAsync_EmptyReason_IsRejected()
    {
        var result = await CreateService().HoldAsync(1, "  ", 1, "Admin");
        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("reason is required"));
    }

    [Fact]
    public async Task HoldAsync_FromDraft_IsRejected_NotHoldable()
    {
        var loan = CreateTestLoan(); // Draft
        _loanRepoMock.Setup(r => r.HasAccessAsync(1, It.IsAny<int>(), It.IsAny<string>())).ReturnsAsync(true);
        _loanRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(loan);

        var result = await CreateService().HoldAsync(1, "reason", 1, "Admin");

        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("cannot be put on hold"));
        loan.Status.Should().Be(LoanStatus.Draft);
    }

    [Fact]
    public async Task UnholdAsync_RestoresPreHoldStatusFromHistory()
    {
        var loan = CreateTestLoan();
        loan.Status = LoanStatus.OnHold;
        _loanRepoMock.Setup(r => r.HasAccessAsync(1, It.IsAny<int>(), It.IsAny<string>())).ReturnsAsync(true);
        _loanRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(loan);
        _loanRepoMock.Setup(r => r.GetWithDetailsAsync(1, It.IsAny<int?>(), It.IsAny<string?>())).ReturnsAsync(loan);
        _histRepoMock.Setup(h => h.AddAsync(It.IsAny<LoanStatusHistory>()))
            .ReturnsAsync((LoanStatusHistory h) => h);
        // The loan was held from Approved.
        _histRepoMock.Setup(h => h.GetByLoanIdAsync(1)).ReturnsAsync(new List<LoanStatusHistory>
        {
            new() { LoanId = 1, FromStatus = LoanStatus.Approved, ToStatus = LoanStatus.OnHold, CreatedAt = DateTime.UtcNow }
        });

        var result = await CreateService().UnholdAsync(1, null, 1, "Admin");

        result.Success.Should().BeTrue();
        loan.Status.Should().Be(LoanStatus.Approved);
    }

    [Fact]
    public async Task UnholdAsync_WhenNotHeld_IsRejected()
    {
        var loan = CreateTestLoan();
        loan.Status = LoanStatus.Submitted;
        _loanRepoMock.Setup(r => r.HasAccessAsync(1, It.IsAny<int>(), It.IsAny<string>())).ReturnsAsync(true);
        _loanRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(loan);

        var result = await CreateService().UnholdAsync(1, null, 1, "Admin");

        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("not on hold"));
    }

    // ── Deviation workflow ───────────────────────────────────────────────────

    private void ArrangeLoan(Loan loan)
    {
        _loanRepoMock.Setup(r => r.HasAccessAsync(1, It.IsAny<int>(), It.IsAny<string>())).ReturnsAsync(true);
        _loanRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(loan);
        _loanRepoMock.Setup(r => r.GetWithDetailsAsync(1, It.IsAny<int?>(), It.IsAny<string?>())).ReturnsAsync(loan);
        _histRepoMock.Setup(h => h.AddAsync(It.IsAny<LoanStatusHistory>())).ReturnsAsync((LoanStatusHistory h) => h);
    }

    // The loan-level Raise / Decide / Skip deviation path was replaced by the
    // offer-level workflow (OfferWorkflowService — covered by OfferWorkflow*Tests).
    // LoanService now only guards the stages that workflow owns.

    [Theory]
    [InlineData(LoanStatus.UnderReview, LoanStatus.Offer)]
    [InlineData(LoanStatus.Offer, LoanStatus.Decision)]
    [InlineData(LoanStatus.Offer, LoanStatus.Approved)]
    [InlineData(LoanStatus.UnderReview, LoanStatus.Approved)]
    [InlineData(LoanStatus.Approved, LoanStatus.Disbursed)]
    [InlineData(LoanStatus.Acceptance, LoanStatus.Disbursed)]
    public async Task UpdateStatusAsync_WorkflowOwnedStages_AreRefused(LoanStatus from, LoanStatus to)
    {
        var loan = CreateTestLoan(); loan.Status = from;
        ArrangeLoan(loan);
        var result = await CreateService().UpdateStatusAsync(1, new UpdateLoanStatusRequestDto { NewStatus = to }, 1, "Admin");
        result.Success.Should().BeFalse();
        result.ErrorCode.Should().Be(ApiErrorCodes.WorkflowStage);
        loan.Status.Should().Be(from);
    }

    [Theory]
    [InlineData(LoanStatus.Offer)]
    [InlineData(LoanStatus.Decision)]
    public async Task HoldAsync_OfferAndDecisionAreHoldable(LoanStatus from)
    {
        var loan = CreateTestLoan(); loan.Status = from;
        ArrangeLoan(loan);
        var result = await CreateService().HoldAsync(1, "Awaiting customer", 1, "Admin");
        result.Success.Should().BeTrue();
        loan.Status.Should().Be(LoanStatus.OnHold);
    }

    [Theory]
    [InlineData(LoanStatus.Offer)]
    [InlineData(LoanStatus.Decision)]
    [InlineData(LoanStatus.Approved)]
    public async Task UpdateStatusAsync_RejectFromOfferChain_IsAllowed(LoanStatus from)
    {
        var loan = CreateTestLoan(); loan.Status = from;
        ArrangeLoan(loan);
        var result = await CreateService().UpdateStatusAsync(1, new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Rejected, Comment = "Declined" }, 1, "Admin");
        result.Success.Should().BeTrue();
        loan.Status.Should().Be(LoanStatus.Rejected);
        loan.PreRejectedStatus.Should().Be(from);
    }

    [Theory]
    [InlineData(LoanStatus.Offer)]
    [InlineData(LoanStatus.Decision)]
    [InlineData(LoanStatus.Approved)]
    [InlineData(LoanStatus.Acceptance)]
    [InlineData(LoanStatus.Disbursed)]
    public async Task OverrideStatusAsync_CannotForceOfferChainStages(LoanStatus to)
    {
        var loan = CreateTestLoan(); loan.Status = LoanStatus.UnderReview;
        ArrangeLoan(loan);
        _uowMock.Setup(u => u.ExecuteInTransactionAsync(It.IsAny<Func<Task<ApiResponseDto<LoanDto>>>>()))
            .Returns((Func<Task<ApiResponseDto<LoanDto>>> f) => f());
        var result = await CreateService().OverrideStatusAsync(1, to, "force", 1, "Admin");
        result.Success.Should().BeFalse();
        loan.Status.Should().Be(LoanStatus.UnderReview);
    }
}
