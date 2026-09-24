using LoanMS.Domain.Enums;
using System.Collections;
using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// Phase 2 RBAC — G-13. GET /api/payout must return every claim ONLY to the
/// finance roles (Admin/Accounts). Every other authenticated role — Manager
/// (Sales-level rights in Payout), Sales/Dsa/Partner and the internal processing roles (LoginTeam/TeamLeader/
/// LocationHead/OperationManager/ProductTeam) that previously fell through to
/// "see all" — must be scoped to their own claims. These tests pin that fix at
/// the backend query level, independent of any UI.
/// </summary>
public class PayoutExposureTests
{
    private const int UserA = 10;   // claimant of claim A
    private const int UserB = 20;   // claimant of claim B

    private static AppDbContext SeedTwoClaims()
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

        var custA = new Customer { Id = 1, FullName = "Cust A" };
        var custB = new Customer { Id = 2, FullName = "Cust B" };
        var userA = new User { Id = UserA, FullName = "User A", Email = "a@x.com" };
        var userB = new User { Id = UserB, FullName = "User B", Email = "b@x.com" };
        // Suggest/Submit now enforce loan visibility, so loan A is placed inside
        // a Manager's real scope (Manager = same Location AND Sales-team
        // membership): User A leads a Sales team and is mapped to Location 1.
        var loanA = new Loan { Id = 1, LoanNumber = "EFIN-A", CustomerId = 1, Customer = custA, CreatedByUserId = UserA, LocationId = 1 };
        db.Locations.Add(new Location { Id = 1, Name = "Loc 1", City = "C", State = "S" });
        db.Teams.Add(new Team { Id = 1, Name = "Sales A", Type = "Sales", TeamLeadUserId = UserA });
        db.UserLocations.Add(new UserLocation { UserId = UserA, LocationId = 1 });
        var loanB = new Loan { Id = 2, LoanNumber = "EFIN-B", CustomerId = 2, Customer = custB, CreatedByUserId = UserB };

        db.Customers.AddRange(custA, custB);
        db.Users.AddRange(userA, userB);
        db.Loans.AddRange(loanA, loanB);
        db.PayoutClaims.AddRange(
            new PayoutClaim { Id = 1, LoanId = 1, Loan = loanA, ClaimedByUserId = UserA, ClaimedBy = userA, ClaimType = "Sales", ClaimAmount = 100, Status = "Pending" },
            new PayoutClaim { Id = 2, LoanId = 2, Loan = loanB, ClaimedByUserId = UserB, ClaimedBy = userB, ClaimType = "Sales", ClaimAmount = 200, Status = "Pending" });
        db.SaveChanges();
        return db;
    }

    private static PayoutController ControllerFor(AppDbContext db, string role, int userId) => new(db)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                {
                    new Claim("userId", userId.ToString()),
                    new Claim(ClaimTypes.Role, role)
                }, "TestAuth"))
            }
        }
    };

    private static int CountFrom(IActionResult result)
    {
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var body = ok.Value.Should().BeOfType<ApiResponseDto<object>>().Subject;
        body.Success.Should().BeTrue();
        var count = 0;
        foreach (var _ in (IEnumerable)body.Data!) count++;
        return count;
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("Accounts")]
    public async Task FinanceRoles_SeeAllClaims(string role)
    {
        using var db = SeedTwoClaims();
        // userId 99 owns neither claim — a finance role still sees both.
        var result = await ControllerFor(db, role, 99).GetAll(status: null, myOnly: false);
        CountFrom(result).Should().Be(2);
    }

    [Theory]
    [InlineData("Manager")]
    [InlineData("LoginTeam")]
    [InlineData("TeamLeader")]
    [InlineData("LocationHead")]
    [InlineData("OperationManager")]
    [InlineData("ProductTeam")]
    [InlineData("Sales")]
    [InlineData("Dsa")]
    [InlineData("Partner")]
    public async Task NonFinanceRoles_SeeOnlyOwnClaims(string role)
    {
        using var db = SeedTwoClaims();
        // Acting as UserA — must see exactly their own single claim, never UserB's.
        var result = await ControllerFor(db, role, UserA).GetAll(status: null, myOnly: false);
        CountFrom(result).Should().Be(1);
    }

    // Manager == Sales in the Payout section: no amount override, no status
    // updates, no Payout Rules access.
    [Theory]
    [InlineData("Manager", false)]
    [InlineData("Sales", false)]
    [InlineData("Admin", true)]
    public async Task Suggest_CanOverride_OnlyForAdmin(string role, bool expected)
    {
        using var db = SeedTwoClaims();
        var result = await ControllerFor(db, role, UserA).Suggest(1);
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var body = ok.Value.Should().BeOfType<ApiResponseDto<object>>().Subject;
        var flag = body.Data!.GetType().GetProperty("canOverride")!.GetValue(body.Data);
        flag.Should().Be(expected);
    }

    [Fact]
    public async Task Submit_OnLoanOutsideCallersScope_IsRefused_AndNoClaimWritten()
    {
        // Regression: Submit used FindAsync with no visibility check, so any
        // user could file a commission claim on any disbursed loan by id.
        using var db = SeedTwoClaims();
        var loanA = db.Loans.Single(l => l.Id == 1);
        loanA.DisbursedAt = DateTime.UtcNow;
        loanA.LoanType = LoanType.Personal;
        // A rule exists, so the only thing that may refuse the claim is visibility.
        db.PayoutRules.Add(new PayoutRule { LoanType = "personal_loan", Percentage = 1.5m, IsActive = true });
        db.SaveChanges();
        var before = db.PayoutClaims.Count();

        // User B (Sales) did not create and is not assigned loan A.
        var result = await ControllerFor(db, "Sales", UserB).Submit(new ClaimCreateDto { LoanId = 1, ClaimAmount = 5000 });

        result.Should().BeOfType<BadRequestObjectResult>();
        db.PayoutClaims.Count().Should().Be(before);
    }

    private static string[] RolesOf(System.Reflection.MemberInfo m) =>
        m.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), true)
         .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
         .SelectMany(a => (a.Roles ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries))
         .Select(r => r.Trim()).ToArray();

    [Fact]
    public void UpdateStatus_IsAdminAndAccountsOnly_NotManager()
    {
        var m = typeof(PayoutController).GetMethod(nameof(PayoutController.UpdateStatus))!;
        RolesOf(m).Should().BeEquivalentTo(new[] { "Admin", "Accounts" });
    }

    [Fact]
    public void PayoutRulesController_IsAdminOnly_NotManager()
    {
        RolesOf(typeof(PayoutRulesController)).Should().BeEquivalentTo(new[] { "Admin" });
    }

    [Fact]
    public async Task MyOnly_ForcesSelfScope_EvenForFinanceRole()
    {
        using var db = SeedTwoClaims();
        var result = await ControllerFor(db, "Admin", UserA).GetAll(status: null, myOnly: true);
        CountFrom(result).Should().Be(1);
    }
}
