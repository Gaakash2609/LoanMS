using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using Moq;
using FluentAssertions;

namespace LoanMS.Tests.Services;

public class CustomerServiceTests
{
    private readonly Mock<IUnitOfWork>         _uowMock     = new();
    private readonly Mock<ICustomerRepository> _repoMock    = new();
    private readonly Mock<ILoanRepository>     _loanMock    = new();
    private readonly Mock<ICacheService>        _cacheMock   = new();

    private CustomerService CreateService()
    {
        _uowMock.Setup(u => u.Customers).Returns(_repoMock.Object);
        _uowMock.Setup(u => u.Loans).Returns(_loanMock.Object);
        _uowMock.Setup(u => u.SaveChangesAsync()).ReturnsAsync(1);

        // Cache mock: always returns null (cache miss) — tests run against real data
        _cacheMock.Setup(c => c.GetAsync<PagedResultDto<CustomerDto>>(It.IsAny<string>()))
                  .ReturnsAsync((PagedResultDto<CustomerDto>?)null);
        _cacheMock.Setup(c => c.SetAsync(It.IsAny<string>(), It.IsAny<PagedResultDto<CustomerDto>>(), It.IsAny<TimeSpan?>()))
                  .Returns(Task.CompletedTask);
        _cacheMock.Setup(c => c.RemoveByPrefixAsync(It.IsAny<string>()))
                  .Returns(Task.CompletedTask);
        _cacheMock.Setup(c => c.RemoveAsync(It.IsAny<string>()))
                  .Returns(Task.CompletedTask);

        return new CustomerService(_uowMock.Object, _cacheMock.Object);
    }

    [Fact]
    public async Task GetByIdAsync_WhenNotFound_ReturnsFail()
    {
        _repoMock.Setup(r => r.GetWithLoansAsync(99, 1, "Admin")).ReturnsAsync((Customer?)null);
        var svc    = CreateService();
        var result = await svc.GetByIdAsync(99, 1, "Admin");
        result.Success.Should().BeFalse();
    }

    [Fact]
    public async Task CreateAsync_DuplicateEmail_ReturnsFail()
    {
        _repoMock.Setup(r => r.EmailExistsAsync("existing@test.com", null)).ReturnsAsync(true);
        var svc = CreateService();
        var result = await svc.CreateAsync(new CreateCustomerRequestDto
        {
            FullName = "Test", Email = "existing@test.com", Phone = "9999999999"
        });
        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("Email already registered"));
    }

    [Fact]
    public async Task CreateAsync_DuplicatePan_ReturnsFail()
    {
        _repoMock.Setup(r => r.EmailExistsAsync(It.IsAny<string>(), null)).ReturnsAsync(false);
        _repoMock.Setup(r => r.PanExistsAsync("ABCDE1234F", null)).ReturnsAsync(true);
        var svc = CreateService();
        var result = await svc.CreateAsync(new CreateCustomerRequestDto
        {
            FullName = "Test", Email = "new@test.com", Phone = "9999999999", PanNumber = "ABCDE1234F"
        });
        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("PAN"));
    }

    [Fact]
    public async Task CreateAsync_ValidData_ReturnsSuccess()
    {
        _repoMock.Setup(r => r.EmailExistsAsync(It.IsAny<string>(), null)).ReturnsAsync(false);
        _repoMock.Setup(r => r.PanExistsAsync(It.IsAny<string>(), null)).ReturnsAsync(false);
        _repoMock.Setup(r => r.AddAsync(It.IsAny<Customer>())).ReturnsAsync((Customer c) => c);

        var svc = CreateService();
        var result = await svc.CreateAsync(new CreateCustomerRequestDto
        {
            FullName = "John Doe", Email = "john@test.com", Phone = "9876543210"
        });

        result.Success.Should().BeTrue();
        result.Data!.FullName.Should().Be("John Doe");
    }

    [Fact]
    public void MaskPan_ShouldMaskCorrectly()
    {
        CustomerService.MaskPan("ABCDE1234F").Should().Be("ABCDEXXXXX");
        CustomerService.MaskPan(null).Should().BeNull();
        CustomerService.MaskPan("").Should().BeEmpty();
    }

    [Fact]
    public void MaskAadhaar_ShouldShowOnlyLast4()
    {
        CustomerService.MaskAadhaar("123456789012").Should().Be("XXXX-XXXX-9012");
        CustomerService.MaskAadhaar(null).Should().BeNull();
    }

    [Fact]
    public async Task GetAllAsync_AlwaysReadsThroughToRepository_NeverCaches()
    {
        // Regression test for the same cross-device/cross-replica staleness bug
        // fixed in LoanService.GetAllAsync: the customer list must always come
        // straight from the database, not from a cache that RemoveByPrefixAsync
        // can silently fail to invalidate (no-op on the Redis-backed
        // DistributedCacheService; per-replica-only under the in-memory
        // fallback on ECS with multiple Fargate tasks). Calling this twice must
        // hit the repository twice — a cache hit on the second call, or any
        // call reaching into ICacheService at all, is exactly the bug this
        // guards against.
        var page = new PagedResultDto<CustomerDto> { Items = new List<CustomerDto>(), TotalCount = 0, Page = 1, PageSize = 20 };
        _repoMock.Setup(r => r.GetPagedAsync(1, 20, null, 1, "Admin")).ReturnsAsync(page);

        var svc = CreateService();
        await svc.GetAllAsync(1, 20, null, 1, "Admin");
        await svc.GetAllAsync(1, 20, null, 1, "Admin");

        _repoMock.Verify(r => r.GetPagedAsync(1, 20, null, 1, "Admin"), Times.Exactly(2));
        _cacheMock.Verify(c => c.GetAsync<PagedResultDto<CustomerDto>>(It.IsAny<string>()), Times.Never);
        _cacheMock.Verify(c => c.SetAsync(It.IsAny<string>(), It.IsAny<PagedResultDto<CustomerDto>>(), It.IsAny<TimeSpan?>()), Times.Never);
        _cacheMock.Verify(c => c.RemoveByPrefixAsync(It.IsAny<string>()), Times.Never);
    }

    [Fact]
    public async Task DeleteAsync_WithActiveLoans_ReturnsFail()
    {
        var customer = new Customer { Id = 1, FullName = "Test", Email = "t@t.com", Phone = "9999999999" };
        _repoMock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(customer);
        _loanMock.Setup(r => r.GetLoansByCustomerAsync(1)).ReturnsAsync(new List<LoanMS.Domain.Entities.Loan>
        {
            new() { Id = 1, Status = LoanStatus.Submitted, LoanNumber = "X", Customer = customer,
                    CreatedBy = new User { Id=1, FullName="Admin", Email="a@a.com" } }
        });

        var svc = CreateService();
        var result = await svc.DeleteAsync(1);
        result.Success.Should().BeFalse();
        result.Errors.Should().Contain(e => e.Contains("active loans"));
    }
}
