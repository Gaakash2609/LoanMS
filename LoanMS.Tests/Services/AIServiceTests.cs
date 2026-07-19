using LoanMS.Application.AI;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using FluentAssertions;

namespace LoanMS.Tests.Services;

public class AIServiceTests
{
    private readonly Mock<IPromptService>   _promptMock  = new();
    private readonly Mock<IUnitOfWork>      _uowMock     = new();
    private readonly Mock<ICustomerRepository> _custMock = new();
    private readonly Mock<ILoanRepository>  _loanMock    = new();
    private readonly Mock<IAIProvider>      _providerMock = new();

    private AIService CreateService(bool enabled = true, bool withProvider = true) =>
        new AIService(
            _promptMock.Object,
            _uowMock.Object,
            NullLogger<AIService>.Instance,
            enabled && withProvider ? _providerMock.Object : null,
            enabled
        );

    [Fact]
    public async Task GetCustomerSummaryAsync_WhenDisabled_ReturnsNull()
    {
        var svc = CreateService(enabled: false);
        var result = await svc.GetCustomerSummaryAsync(1);
        result.Should().BeNull();
    }

    [Fact]
    public async Task GetCustomerSummaryAsync_WhenCustomerNotFound_ReturnsNull()
    {
        _uowMock.Setup(u => u.Customers).Returns(_custMock.Object);
        _custMock.Setup(r => r.GetByIdAsync(99)).ReturnsAsync((Customer?)null);
        var svc = CreateService();
        var result = await svc.GetCustomerSummaryAsync(99);
        result.Should().BeNull();
    }

    [Fact]
    public async Task GetCustomerSummaryAsync_WhenEnabled_ReturnsAISummary()
    {
        var customer = new Customer
        {
            Id = 1, FullName = "Test Customer", Email = "t@t.com", Phone = "9999999999",
            EmploymentType = "Salaried", MonthlyIncome = 75000, CibilScore = 780
        };
        _uowMock.Setup(u => u.Customers).Returns(_custMock.Object);
        _custMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(customer);
        _promptMock.Setup(p => p.BuildCustomerSummaryPrompt(It.IsAny<object>()))
                   .Returns("Build summary prompt");
        _providerMock.Setup(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
                     .ReturnsAsync("Customer has excellent CIBIL score of 780.");

        var svc = CreateService();
        var result = await svc.GetCustomerSummaryAsync(1);

        result.Should().NotBeNull();
        result.Should().Contain("CIBIL");
    }

    [Fact]
    public async Task GetLoanInsightAsync_WhenProviderThrows_ReturnsNull()
    {
        var loan = CreateTestLoan();
        _uowMock.Setup(u => u.Loans).Returns(_loanMock.Object);
        _loanMock.Setup(r => r.GetWithDetailsAsync(1)).ReturnsAsync(loan);
        _promptMock.Setup(p => p.BuildLoanInsightPrompt(It.IsAny<object>())).Returns("prompt");
        _providerMock.Setup(p => p.CompleteAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>()))
                     .ThrowsAsync(new HttpRequestException("API timeout"));

        var svc = CreateService();
        var result = await svc.GetLoanInsightAsync(1);

        // Should NOT throw — graceful null return on AI failure
        result.Should().BeNull();
    }

    [Fact]
    public void IsEnabled_WhenDisabled_ReturnsFalse()
    {
        var svc = CreateService(enabled: false);
        svc.IsEnabled.Should().BeFalse();
    }

    [Fact]
    public void IsEnabled_WhenEnabledWithProvider_ReturnsTrue()
    {
        var svc = CreateService(enabled: true, withProvider: true);
        svc.IsEnabled.Should().BeTrue();
    }

    private static Loan CreateTestLoan() => new()
    {
        Id = 1, LoanNumber = "LMS-TEST-001", LoanType = LoanType.Personal,
        Status = LoanStatus.Draft, RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
        Customer = new Customer { Id=1, FullName="Test", Email="t@t.com", Phone="9999999999" },
        CreatedBy = new User { Id=1, FullName="Admin", Email="a@a.com", Role=UserRole.Admin }
    };
}
