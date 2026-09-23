using FluentAssertions;
using LoanMS.API.Services;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanMS.Tests.Services;

/// <summary>
/// Phase 2 RBAC — G-05. Deterministic Login-User auto-assignment engine.
/// Verifies eligibility (active + location), least-workload selection, the
/// deterministic tie-break, the safe no-op cases, and that an immutable
/// AssignmentAuditLog trail row is written for every decision.
/// </summary>
public class LoginUserAssignmentServiceTests
{
    private const int Location = 5;

    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static User LoginUser(int id, string name, bool active = true, int? locationId = Location) =>
        new() { Id = id, FullName = name, Email = $"{id}@x.com", Role = UserRole.LoginTeam, IsActive = active, LocationId = locationId };

    private static Loan AssignableLoan(int id = 100, int? locationId = Location) =>
        new() { Id = id, LoanNumber = $"EFIN-{id}", LoanType = LoanType.Personal, Status = LoanStatus.Submitted, CustomerId = 1, CreatedByUserId = 1, LocationId = locationId };

    private static Loan ActiveLoanFor(int loginUserId, int id) =>
        new() { Id = id, LoanNumber = $"W-{id}", Status = LoanStatus.UnderReview, CustomerId = 1, CreatedByUserId = 1, LoginUserId = loginUserId, LocationId = Location };

    [Fact]
    public async Task Assigns_LeastLoaded_EligibleLoginUser()
    {
        using var db = NewDb();
        db.Users.AddRange(LoginUser(11, "Idle"), LoginUser(12, "Busy"));
        db.Loans.AddRange(ActiveLoanFor(12, 201), ActiveLoanFor(12, 202));   // user 12 has 2 in-flight
        var loan = AssignableLoan();
        db.Loans.Add(loan);
        await db.SaveChangesAsync();

        var result = await new LoginUserAssignmentService(db).AutoAssignLoginUserAsync(loan);
        await db.SaveChangesAsync();

        result.Assigned.Should().BeTrue();
        result.AssignedUserId.Should().Be(11);           // idle user wins on workload
        loan.LoginUserId.Should().Be(11);
        db.AssignmentAuditLogs.Single(a => a.LoanApplicationId == loan.Id)
          .Method.Should().Be("auto");
    }

    [Fact]
    public async Task Excludes_InactiveUsers()
    {
        using var db = NewDb();
        db.Users.Add(LoginUser(11, "Suspended", active: false));   // only candidate is inactive
        var loan = AssignableLoan();
        db.Loans.Add(loan);
        await db.SaveChangesAsync();

        var result = await new LoginUserAssignmentService(db).AutoAssignLoginUserAsync(loan);

        result.Assigned.Should().BeFalse();
        loan.LoginUserId.Should().BeNull();
    }

    [Fact]
    public async Task NoLocation_LeavesUnassigned()
    {
        using var db = NewDb();
        db.Users.Add(LoginUser(11, "Idle"));
        var loan = AssignableLoan(locationId: null);
        db.Loans.Add(loan);
        await db.SaveChangesAsync();

        var result = await new LoginUserAssignmentService(db).AutoAssignLoginUserAsync(loan);

        result.Assigned.Should().BeFalse();
        loan.LoginUserId.Should().BeNull();
    }

    [Fact]
    public async Task NoEligibleUserAtLocation_LeavesUnassigned()
    {
        using var db = NewDb();
        db.Users.Add(LoginUser(11, "Elsewhere", locationId: 99));   // eligible for a different location
        var loan = AssignableLoan();
        db.Loans.Add(loan);
        await db.SaveChangesAsync();

        var result = await new LoginUserAssignmentService(db).AutoAssignLoginUserAsync(loan);

        result.Assigned.Should().BeFalse();
        loan.LoginUserId.Should().BeNull();
    }

    [Fact]
    public async Task DoesNotOverride_ExistingAssignment()
    {
        using var db = NewDb();
        db.Users.Add(LoginUser(11, "Idle"));
        var loan = AssignableLoan();
        loan.LoginUserId = 77;      // already routed
        db.Loans.Add(loan);
        await db.SaveChangesAsync();

        var result = await new LoginUserAssignmentService(db).AutoAssignLoginUserAsync(loan);

        result.Assigned.Should().BeFalse();
        loan.LoginUserId.Should().Be(77);
    }

    [Fact]
    public async Task Eligible_ViaUserLocationsManyToMany()
    {
        using var db = NewDb();
        // Primary LocationId is a DIFFERENT location; the many-to-many mapping is
        // what makes this user eligible for the loan's Location.
        db.Users.Add(LoginUser(11, "Mapped", locationId: 1));
        db.UserLocations.Add(new UserLocation { Id = 1, UserId = 11, LocationId = Location });
        var loan = AssignableLoan();
        db.Loans.Add(loan);
        await db.SaveChangesAsync();

        var result = await new LoginUserAssignmentService(db).AutoAssignLoginUserAsync(loan);

        result.Assigned.Should().BeTrue();
        loan.LoginUserId.Should().Be(11);
    }

    [Fact]
    public async Task Tie_BrokenBy_LeastRecentlyAssigned_ThenLowestId()
    {
        using var db = NewDb();
        db.Users.AddRange(LoginUser(11, "A"), LoginUser(12, "B"));   // equal (zero) workload
        // User 12 was assigned very recently; user 11 never → 11 should win.
        db.AssignmentAuditLogs.Add(new AssignmentAuditLog
        {
            Id = 1, LoanFrontendId = "old", AssignedToUserId = 12, Method = "auto",
            AssignedAt = DateTime.UtcNow, CreatedAt = DateTime.UtcNow
        });
        var loan = AssignableLoan();
        db.Loans.Add(loan);
        await db.SaveChangesAsync();

        var result = await new LoginUserAssignmentService(db).AutoAssignLoginUserAsync(loan);

        result.Assigned.Should().BeTrue();
        result.TieBreak.Should().BeTrue();
        loan.LoginUserId.Should().Be(11);
    }
}
