using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using LoanMS.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using FluentAssertions;

namespace LoanMS.Tests.Repositories;

/// <summary>
/// Phase 1 — Customer Visibility. These run against a real (InMemory) EF Core
/// context because the scoping logic lives in the query itself
/// (CustomerRepository.ApplyCustomerVisibilityScope, which reuses
/// LoanRepository.ApplyVisibilityScope) — a mocked ICustomerRepository can't
/// exercise that query, only the service layer that calls it.
/// </summary>
public class CustomerRepositoryTests
{
    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private static async Task<(AppDbContext db, Customer visibleCustomer, Customer hiddenCustomer)> SeedAsync()
    {
        var db = CreateContext();

        var salesUserA = new User { Id = 1, FullName = "Sales A", Email = "a@efin.com", Role = UserRole.Sales };
        var salesUserB = new User { Id = 2, FullName = "Sales B", Email = "b@efin.com", Role = UserRole.Sales };

        // visibleCustomer has a loan created by salesUserA -> visible to user 1.
        var visibleCustomer = new Customer { Id = 1, FullName = "Visible Cust", Email = "v@t.com", Phone = "9000000001" };
        // hiddenCustomer only has a loan created by salesUserB -> not visible to user 1.
        var hiddenCustomer = new Customer { Id = 2, FullName = "Hidden Cust", Email = "h@t.com", Phone = "9000000002" };

        db.Users.AddRange(salesUserA, salesUserB);
        db.Customers.AddRange(visibleCustomer, hiddenCustomer);
        db.Loans.Add(new Loan
        {
            Id = 1, LoanNumber = "EFIN2026TEST001", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = visibleCustomer.Id, CreatedByUserId = salesUserA.Id
        });
        db.Loans.Add(new Loan
        {
            Id = 2, LoanNumber = "EFIN2026TEST002", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 100000, InterestRate = 10, TenureMonths = 12,
            CustomerId = hiddenCustomer.Id, CreatedByUserId = salesUserB.Id
        });

        await db.SaveChangesAsync();
        return (db, visibleCustomer, hiddenCustomer);
    }

    [Fact]
    public async Task GetPagedAsync_SalesUser_UnauthorizedCustomerHidden()
    {
        var (db, visibleCustomer, hiddenCustomer) = await SeedAsync();
        var repo = new CustomerRepository(db);

        var result = await repo.GetPagedAsync(1, 50, null, currentUserId: 1, currentUserRole: "Sales");

        result.Items.Should().Contain(c => c.Id == visibleCustomer.Id);
        result.Items.Should().NotContain(c => c.Id == hiddenCustomer.Id);
    }

    [Fact]
    public async Task GetPagedAsync_SalesUser_AuthorizedCustomerVisible()
    {
        var (db, visibleCustomer, _) = await SeedAsync();
        var repo = new CustomerRepository(db);

        var result = await repo.GetPagedAsync(1, 50, null, currentUserId: 1, currentUserRole: "Sales");

        result.Items.Should().ContainSingle(c => c.Id == visibleCustomer.Id);
    }

    [Fact]
    public async Task GetWithLoansAsync_SalesUser_UnauthorizedCustomerReturnsNull()
    {
        var (db, _, hiddenCustomer) = await SeedAsync();
        var repo = new CustomerRepository(db);

        var result = await repo.GetWithLoansAsync(hiddenCustomer.Id, currentUserId: 1, currentUserRole: "Sales");

        result.Should().BeNull();
    }

    [Fact]
    public async Task GetWithLoansAsync_SalesUser_AuthorizedCustomerReturnsRecord()
    {
        var (db, visibleCustomer, _) = await SeedAsync();
        var repo = new CustomerRepository(db);

        var result = await repo.GetWithLoansAsync(visibleCustomer.Id, currentUserId: 1, currentUserRole: "Sales");

        result.Should().NotBeNull();
        result!.Id.Should().Be(visibleCustomer.Id);
    }

    [Fact]
    public async Task GetPagedAsync_Admin_SeesAllCustomers_IncludingOnesWithNoLoans()
    {
        var db = CreateContext();
        var repo = new CustomerRepository(db);
        var loanlessCustomer = new Customer { Id = 5, FullName = "No Loans", Email = "n@t.com", Phone = "9000000005" };
        db.Customers.Add(loanlessCustomer);
        await db.SaveChangesAsync();

        var result = await repo.GetPagedAsync(1, 50, null, currentUserId: 99, currentUserRole: "Admin");

        result.Items.Should().Contain(c => c.Id == loanlessCustomer.Id);
    }
}
