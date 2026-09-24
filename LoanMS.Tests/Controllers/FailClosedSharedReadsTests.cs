using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.API.Services;
using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanMS.Tests.Controllers;

// ── Shared reads under the fail-closed matrix (master prompt Part 4) ─────────
// With no saved permission matrix the real RolePermissionService now applies
// the secure defaults. These reads are used outside their management pages
// and must keep working for the roles that legitimately use them.
public class FailClosedSharedReadsTests
{
    private static AppDbContext NewDb() => new(new DbContextOptionsBuilder<AppDbContext>()
        .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static T As<T>(T controller, int userId, string role) where T : ControllerBase
    {
        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                {
                    new Claim("userId", userId.ToString()), new Claim("role", role),
                }, "TestAuth")),
            },
        };
        return controller;
    }

    private static List<int> Ids(IActionResult result) =>
        ((IEnumerable<object>)((ApiResponseDto<object>)((OkObjectResult)result).Value!).Data!)
            .Select(i => (int)i.GetType().GetProperty("Id")!.GetValue(i)!).ToList();

    private static DsaController Dsa(AppDbContext db, int userId, string role) =>
        As(new DsaController(db, new LoanMS.Infrastructure.Services.LocalFileStorageService(Path.GetTempPath()),
            new RolePermissionService(db)), userId, role);

    [Fact]
    public async Task Partner_StillReadsItsOwnRecord_WithoutTheManagementMenu()
    {
        var db = NewDb();
        db.DsaPartners.AddRange(
            new DsaPartner { Id = 1, Name = "Mine", Code = "P1", PartnerType = PartnerType.Partner, LinkedUserId = 7 },
            new DsaPartner { Id = 2, Name = "Other", Code = "P2", PartnerType = PartnerType.Partner, LinkedUserId = 8 });
        await db.SaveChangesAsync();

        Ids(await Dsa(db, 7, "Partner").GetAll()).Should().Equal(1);
    }

    [Fact]
    public async Task Dsa_StillReadsItsOwnRecordAndMappedPartners()
    {
        var db = NewDb();
        db.DsaPartners.AddRange(
            new DsaPartner { Id = 1, Name = "My DSA", Code = "D1", PartnerType = PartnerType.Dsa, LinkedUserId = 7 },
            new DsaPartner { Id = 2, Name = "Mapped", Code = "P2", PartnerType = PartnerType.Partner, MappedDsaId = 1 },
            new DsaPartner { Id = 3, Name = "Other", Code = "P3", PartnerType = PartnerType.Partner });
        await db.SaveChangesAsync();

        Ids(await Dsa(db, 7, "Dsa").GetAll()).Should().BeEquivalentTo(new[] { 1, 2 });
    }

    [Fact]
    public async Task Role_WithoutEitherManagementMenu_IsRefusedTheDirectory()
    {
        var db = NewDb();
        db.DsaPartners.Add(new DsaPartner { Id = 1, Name = "X", Code = "D1", PartnerType = PartnerType.Dsa });
        await db.SaveChangesAsync();

        (await Dsa(db, 5, "Accounts").GetAll()).Should().BeOfType<ForbidResult>();
    }

    [Fact]
    public async Task TeamList_IsReadable_WithAnyOneTeamMenu()
    {
        var db = NewDb();
        db.Teams.Add(new Team { Id = 1, Name = "North Sales", Type = "Sales", TeamLeadUserId = 3 });
        await db.SaveChangesAsync();

        // Manager: Team Overview on, Sales Teams off by default — the loan
        // assignment / report pickers still ask for type=Sales.
        var mgr = As(new TeamsController(db, new RolePermissionService(db)), 3, "Manager");
        Ids(await mgr.GetAll("Sales")).Should().Equal(1);

        var accounts = As(new TeamsController(db, new RolePermissionService(db)), 4, "Accounts");
        (await accounts.GetAll("Sales")).Should().BeOfType<ForbidResult>();
    }

    [Fact]
    public async Task OwnFiguresSummary_DoesNotNeedTheReportsMenu_ButTheReportsScopeDoes()
    {
        var db = NewDb();
        var reports = As(new ReportsController(db, new RolePermissionService(db)), 9, "Sales");

        (await reports.Summary(null, null, "mine", null, null, null)).Should().BeOfType<OkObjectResult>();
        (await reports.Summary(null, null, null, null, null, null)).Should().BeOfType<ForbidResult>();
        (await reports.Summary(null, null, "team", null, null, null)).Should().BeOfType<ForbidResult>();
    }
}
