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
/// NOTE ON VERIFICATION: same caveat as the other test files in this project
/// — could not be executed in the sandbox that produced it (no .NET SDK
/// available; network allowlist excludes the Microsoft/NuGet feeds needed).
/// Written against the actual TeamsController.GetAll source but not
/// compiler- or run-verified. Run `dotnet test` locally before relying on
/// these.
///
/// Phase 4 — Manager now only sees teams they lead (Team.TeamLeadUserId) or
/// are a member of (TeamMember), per the existing client-side rule ported
/// from efin-app.js ("MANAGER: same scope as team_leader"). Admin is
/// unrestricted, unchanged.
/// </summary>
public class TeamsControllerTests
{
    private static (TeamsController controller, AppDbContext db) CreateController(int currentUserId, string currentUserRole)
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new AppDbContext(options);

        var claims = new ClaimsIdentity(new[]
        {
            new Claim("userId", currentUserId.ToString()),
            new Claim("role", currentUserRole)
        }, "TestAuth");

        var controller = new TeamsController(db)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(claims) }
            }
        };

        return (controller, db);
    }

    private static List<int> ExtractTeamIds(IActionResult result)
    {
        var ok = (OkObjectResult)result;
        var response = (ApiResponseDto<object>)ok.Value!;
        var items = (IEnumerable<object>)response.Data!;
        return items.Select(i => (int)i.GetType().GetProperty("Id")!.GetValue(i)!).ToList();
    }

    [Fact]
    public async Task Manager_SeesLedTeam_AuthorizedTeamVisible()
    {
        var (controller, db) = CreateController(currentUserId: 1, currentUserRole: "Manager");
        db.Teams.Add(new Team { Id = 1, Name = "My Team", Type = "Sales", TeamLeadUserId = 1 });
        db.Teams.Add(new Team { Id = 2, Name = "Other Team", Type = "Sales", TeamLeadUserId = 2 });
        await db.SaveChangesAsync();

        var result = await controller.GetAll(null);
        var ids = ExtractTeamIds(result);

        ids.Should().Contain(1);
        ids.Should().NotContain(2);
    }

    [Fact]
    public async Task Manager_SeesMemberTeam_AuthorizedTeamVisible()
    {
        var (controller, db) = CreateController(currentUserId: 3, currentUserRole: "Manager");
        var memberTeam = new Team { Id = 1, Name = "Member Team", Type = "Sales", TeamLeadUserId = 9 };
        var otherTeam  = new Team { Id = 2, Name = "Unrelated Team", Type = "Sales", TeamLeadUserId = 8 };
        db.Teams.AddRange(memberTeam, otherTeam);
        await db.SaveChangesAsync();
        db.TeamMembers.Add(new TeamMember { TeamId = memberTeam.Id, UserId = 3 });
        await db.SaveChangesAsync();

        var result = await controller.GetAll(null);
        var ids = ExtractTeamIds(result);

        ids.Should().Contain(1);
        ids.Should().NotContain(2);
    }

    [Fact]
    public async Task Manager_RemovedMembership_TeamHidden()
    {
        // A soft-removed (IsDeleted) membership must not still grant visibility.
        var (controller, db) = CreateController(currentUserId: 3, currentUserRole: "Manager");
        var team = new Team { Id = 1, Name = "Former Team", Type = "Sales", TeamLeadUserId = 9 };
        db.Teams.Add(team);
        await db.SaveChangesAsync();
        db.TeamMembers.Add(new TeamMember { TeamId = team.Id, UserId = 3, IsDeleted = true });
        await db.SaveChangesAsync();

        var result = await controller.GetAll(null);
        var ids = ExtractTeamIds(result);

        ids.Should().NotContain(1);
    }

    [Fact]
    public async Task Admin_SeesAllTeams_Unchanged()
    {
        var (controller, db) = CreateController(currentUserId: 99, currentUserRole: "Admin");
        db.Teams.Add(new Team { Id = 1, Name = "Team A", Type = "Sales", TeamLeadUserId = 1 });
        db.Teams.Add(new Team { Id = 2, Name = "Team B", Type = "Sales", TeamLeadUserId = 2 });
        await db.SaveChangesAsync();

        var result = await controller.GetAll(null);
        var ids = ExtractTeamIds(result);

        ids.Should().Contain(1);
        ids.Should().Contain(2);
    }
}
