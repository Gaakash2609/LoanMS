using FluentAssertions;
using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using LoanMS.Infrastructure.Repositories;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanMS.Tests.Repositories;

/// <summary>
/// The Applications Advanced Filter used to run in the browser on the current
/// page only. These pin the server-side predicates: matches on every page are
/// found, totals reflect the filter, and each predicate keeps the old meaning.
/// </summary>
public class LoanAdvancedFilterTests
{
    private static async Task<AppDbContext> SeedAsync()
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        db.Users.AddRange(
            new User { Id = 1, FullName = "Asha Sales", Email = "a@x.com", PasswordHash = "x", Role = UserRole.Sales },
            new User { Id = 2, FullName = "Ravi Login", Email = "r@x.com", PasswordHash = "x", Role = UserRole.LoginTeam });
        db.Locations.AddRange(new Location { Id = 1, Name = "Pune", City = "Pune", State = "MH" },
                              new Location { Id = 2, Name = "Delhi", City = "Delhi", State = "DL" });
        for (var i = 1; i <= 30; i++)
        {
            var c = new Customer { Id = i, FullName = $"C{i}", Email = $"c{i}@x.com", Phone = $"90000000{i:00}",
                                   CibilScore = i % 3 == 0 ? null : 600 + i * 5, City = i % 2 == 0 ? "Pune" : "Delhi",
                                   MonthlyIncome = 20000 + i * 1000 };
            db.Customers.Add(c);
            db.Loans.Add(new Loan
            {
                Id = i, LoanNumber = $"L{i:000}", CustomerId = i, CreatedByUserId = 1,
                AssignedToUserId = i == 7 ? 2 : null,
                LocationId = i % 5 == 0 ? 2 : 1, RequestedAmount = i * 10000, InterestRate = 12, TenureMonths = 24,
                Remarks = i % 4 == 0 ? "Source: Direct | Channel: referral" : "Source: Direct | Channel: walk-in",
                CreatedAt = new DateTime(2026, 1, 1).AddDays(i),
            });
        }
        await db.SaveChangesAsync();
        return db;
    }

    private static Task<PagedResultDto<LoanListDto>> Page(AppDbContext db, LoanFilterDto f) =>
        new LoanRepository(db).GetPagedAsync(f);

    [Fact]
    public async Task Location_FindsMatchesOnEveryPage_AndTotalIsFiltered()
    {
        using var db = await SeedAsync();
        // Delhi = loans 5,10,15,20,25,30 — spread across pages of 5
        var p1 = await Page(db, new LoanFilterDto { Location = "delhi", Page = 1, PageSize = 5 });
        p1.TotalCount.Should().Be(6);
        p1.Items.Should().HaveCount(5).And.OnlyContain(l => l.LocationName == "Delhi");
        var p2 = await Page(db, new LoanFilterDto { Location = "Delhi", Page = 2, PageSize = 5 });
        p2.Items.Should().ContainSingle();
    }

    [Fact]
    public async Task SalesPerson_MatchesCreatorOrAssignee()
    {
        using var db = await SeedAsync();
        (await Page(db, new LoanFilterDto { SalesPerson = "RAVI LOGIN", PageSize = 100 })).Items
            .Select(l => l.Id).Should().Equal(7);
        (await Page(db, new LoanFilterDto { SalesPerson = "asha sales", PageSize = 100 })).TotalCount.Should().Be(30);
    }

    [Fact]
    public async Task Channel_IsReadFromRemarks()
    {
        using var db = await SeedAsync();
        (await Page(db, new LoanFilterDto { Channel = "Referral", PageSize = 100 })).TotalCount.Should().Be(7);   // 4,8,…,28
        (await Page(db, new LoanFilterDto { Channel = "walk-in", PageSize = 100 })).TotalCount.Should().Be(23);
    }

    [Fact]
    public async Task NumericBounds_AreInclusive_AndBlankScoresNeverMatch()
    {
        using var db = await SeedAsync();
        (await Page(db, new LoanFilterDto { MinAmount = 100000, MaxAmount = 150000, PageSize = 100 })).TotalCount.Should().Be(6);
        var cibil = await Page(db, new LoanFilterDto { MinCibil = 700, PageSize = 100 });
        cibil.Items.Should().OnlyContain(l => l.CustomerCibilScore != null && l.CustomerCibilScore >= 700);
        cibil.TotalCount.Should().Be(Enumerable.Range(1, 30).Count(i => i % 3 != 0 && 600 + i * 5 >= 700));
        (await Page(db, new LoanFilterDto { MinSalary = 45000, City = "PUNE", PageSize = 100 })).Items
            .Should().OnlyContain(l => l.CustomerCity == "Pune" && l.CustomerMonthlyIncome >= 45000);
    }

    [Fact]
    public async Task FilterOptions_ComeFromAllVisibleLoans_NotOnePage()
    {
        using var db = await SeedAsync();
        var o = await new LoanRepository(db).GetFilterOptionsAsync(1, "Admin");
        o.Locations.Should().BeEquivalentTo("Delhi", "Pune");
        o.Channels.Should().BeEquivalentTo("referral", "walk-in");
        o.SalesPeople.Should().BeEquivalentTo("Asha Sales", "Ravi Login");
    }
}
