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

        return new LoanService(_uowMock.Object, _cacheMock.Object);
    }

    [Fact]
    public async Task GetByIdAsync_WhenLoanNotFound_ReturnsFail()
    {
        _loanRepoMock.Setup(r => r.GetWithDetailsAsync(99)).ReturnsAsync((Loan?)null);
        var svc    = CreateService();
        var result = await svc.GetByIdAsync(99);
        result.Success.Should().BeFalse();
        result.Message.Should().Contain("not found");
    }

    [Fact]
    public async Task GetByIdAsync_WhenLoanExists_ReturnsSuccess()
    {
        var loan = CreateTestLoan();
        _loanRepoMock.Setup(r => r.GetWithDetailsAsync(1)).ReturnsAsync(loan);
        var svc    = CreateService();
        var result = await svc.GetByIdAsync(1, "Admin");
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
        result.Message.Should().Contain("Customer not found");
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
    public void MapToDto_WithZeroRate_ReturnsSimpleDivisionEmi()
    {
        var loan = CreateTestLoan();
        loan.InterestRate    = 0;
        loan.RequestedAmount = 120000;
        loan.TenureMonths    = 12;
        var dto = LoanService.MapToDto(loan, "Admin");
        dto.Should().NotBeNull();
        // When rate=0, EMI = principal / months = 10000
        dto.MonthlyEmi.Should().Be(10000m);
    }

    [Fact]
    public async Task UpdateStatusAsync_InvalidTransition_ReturnsFail()
    {
        var loan = CreateTestLoan();
        loan.Status = LoanStatus.Closed;
        _loanRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(loan);

        var svc    = CreateService();
        var result = await svc.UpdateStatusAsync(1,
            new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Approved, Comment = "Test" }, 1);

        result.Success.Should().BeFalse();
        result.Message.Should().Contain("Cannot move");
    }

    [Fact]
    public async Task UpdateStatusAsync_ValidTransition_ReturnsSuccess()
    {
        var loan = CreateTestLoan();
        loan.Status = LoanStatus.Draft;
        _loanRepoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(loan);
        _histRepoMock.Setup(r => r.AddAsync(It.IsAny<LoanStatusHistory>())).ReturnsAsync(new LoanStatusHistory());
        _loanRepoMock.Setup(r => r.UpdateAsync(It.IsAny<Loan>())).ReturnsAsync((Loan l) => l);
        _loanRepoMock.Setup(r => r.GetWithDetailsAsync(1)).ReturnsAsync(loan);

        var svc    = CreateService();
        var result = await svc.UpdateStatusAsync(1,
            new UpdateLoanStatusRequestDto { NewStatus = LoanStatus.Submitted, Comment = "Submitting" }, 1);

        result.Success.Should().BeTrue();
        // Verify cache invalidation was called
        _cacheMock.Verify(c => c.RemoveByPrefixAsync("dashboard:"), Times.Once);
    }

    [Fact]
    public async Task DashboardStats_CacheMiss_FetchesAndCaches()
    {
        var stats = new DashboardStatsDto();
        _uowMock.Setup(u => u.Loans).Returns(_loanRepoMock.Object);
        _loanRepoMock.Setup(r => r.GetDashboardStatsAsync(It.IsAny<int?>(), It.IsAny<string?>()))
                     .ReturnsAsync(stats);

        var svc = CreateService();
        var result = await svc.GetDashboardStatsAsync(1, "Admin");

        result.Success.Should().BeTrue();
        // Verify cache was populated after miss
        _cacheMock.Verify(c => c.SetAsync(
            It.Is<string>(k => k.StartsWith("dashboard:")),
            It.IsAny<DashboardStatsDto>(),
            It.Is<TimeSpan?>(t => t == TimeSpan.FromSeconds(60))), Times.Once);
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
