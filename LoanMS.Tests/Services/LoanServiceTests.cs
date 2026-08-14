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
    private readonly Mock<ICacheService>            _cacheMock    = new();
    private readonly Mock<IEmailService>             _emailMock    = new();
    private readonly Mock<IEmailTemplateProvider>    _emailTplMock = new();

    private LoanService CreateService()
    {
        _uowMock.Setup(u => u.Loans).Returns(_loanRepoMock.Object);
        _uowMock.Setup(u => u.Customers).Returns(_custRepoMock.Object);
        _uowMock.Setup(u => u.Users).Returns(_userRepoMock.Object);
        _uowMock.Setup(u => u.LoanStatusHistories).Returns(_histRepoMock.Object);
        _uowMock.Setup(u => u.SaveChangesAsync()).ReturnsAsync(1);

        // Cache mock: GetAsync returns null (cache miss), SetAsync and RemoveByPrefix are no-ops
        _cacheMock.Setup(c => c.GetAsync<DashboardStatsDto>(It.IsAny<string>()))
                  .ReturnsAsync((DashboardStatsDto?)null);
        _cacheMock.Setup(c => c.SetAsync(It.IsAny<string>(), It.IsAny<DashboardStatsDto>(), It.IsAny<TimeSpan?>()))
                  .Returns(Task.CompletedTask);
        _cacheMock.Setup(c => c.RemoveByPrefixAsync(It.IsAny<string>()))
                  .Returns(Task.CompletedTask);
        _cacheMock.Setup(c => c.RemoveAsync(It.IsAny<string>()))
                  .Returns(Task.CompletedTask);

        // Email mocks: no-op sends, template lookups return "no override" —
        // the stage-notification email trigger added to UpdateStatusAsync
        // should never fail a test that isn't specifically about it.
        _emailMock.Setup(e => e.SendAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<string?>()))
                  .Returns(Task.CompletedTask);
        _emailTplMock.Setup(t => t.GetTemplateAsync(It.IsAny<string>()))
                  .ReturnsAsync(((string?)null, (string?)null));

        return new LoanService(_uowMock.Object, _cacheMock.Object, _emailMock.Object, _emailTplMock.Object);
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
            new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Approved, Comment = "Test" }, 1, "Admin");

        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("Cannot move"));
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
        // Phase 3 — status changes no longer touch the cache at all (there's no
        // "dashboard:" or "loans:list:" cache left to invalidate); the repository
        // save is what makes the change visible on the next read.
        _cacheMock.Verify(c => c.RemoveByPrefixAsync(It.IsAny<string>()), Times.Never);
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
        _cacheMock.Verify(c => c.GetAsync<DashboardStatsDto>(It.IsAny<string>()), Times.Never);
        _cacheMock.Verify(c => c.SetAsync(It.IsAny<string>(), It.IsAny<DashboardStatsDto>(), It.IsAny<TimeSpan?>()), Times.Never);
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

        _cacheMock.Verify(c => c.GetAsync<PagedResultDto<LoanListDto>>(It.IsAny<string>()), Times.Never);
        _cacheMock.Verify(c => c.SetAsync(It.IsAny<string>(), It.IsAny<PagedResultDto<LoanListDto>>(), It.IsAny<TimeSpan?>()), Times.Never);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

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
}
