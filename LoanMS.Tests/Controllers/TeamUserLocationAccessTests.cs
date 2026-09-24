using System.Reflection;
using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.API.Services;
using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace LoanMS.Tests.Controllers;

// ── Team pages / Users list / Locations access (master prompt Part 5) ────────
// TeamLeader, LocationHead and OperationManager read the team pages scoped to
// their own teams / Location; LocationHead reads its own Location's users;
// ProductTeam manages users and teams org-wide but never an Admin account.
// Runs against the real, fail-closed RolePermissionService (nothing saved).
public class TeamUserLocationAccessTests
{
    // Locations 1 and 2. Users: 1 Admin; 10 LocationHead @L1; 11 Sales @L1
    // (UserLocations); 12 Sales @L2; 13 Sales with only a primary LocationId=1;
    // 14 TeamLeader, leads team 100 @L2; 15 member of team 100.
    // Teams: 100 Sales @L2 (lead 14), 101 Sales @L1, 102 Login @L2.
    private static AppDbContext Seed()
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        db.Locations.AddRange(
            new Location { Id = 1, Name = "Jaipur", City = "Jaipur", State = "RJ", Code = "JP" },
            new Location { Id = 2, Name = "Delhi", City = "Delhi", State = "DL", Code = "DL" });
        db.Users.AddRange(
            new User { Id = 1, FullName = "Admin", Email = "a@x", Role = UserRole.Admin },
            new User { Id = 10, FullName = "Zonal", Email = "z@x", Role = UserRole.LocationHead, LocationId = 1 },
            new User { Id = 11, FullName = "Sales L1", Email = "s1@x", Role = UserRole.Sales },
            new User { Id = 12, FullName = "Sales L2", Email = "s2@x", Role = UserRole.Sales },
            new User { Id = 13, FullName = "Sales primary L1", Email = "s3@x", Role = UserRole.Sales, LocationId = 1 },
            new User { Id = 14, FullName = "Leader", Email = "l@x", Role = UserRole.TeamLeader },
            new User { Id = 15, FullName = "Member", Email = "m@x", Role = UserRole.OperationManager });
        db.UserLocations.AddRange(
            new UserLocation { UserId = 10, LocationId = 1 },
            new UserLocation { UserId = 11, LocationId = 1 },
            new UserLocation { UserId = 12, LocationId = 2 },
            new UserLocation { UserId = 12, LocationId = 1, IsDeleted = true }); // unassigned
        db.Teams.AddRange(
            new Team { Id = 100, Name = "Delhi Sales", Type = "Sales", LocationId = 2, TeamLeadUserId = 14 },
            new Team { Id = 101, Name = "Jaipur Sales", Type = "Sales", LocationId = 1 },
            new Team { Id = 102, Name = "Delhi Login", Type = "Login", LocationId = 2 });
        db.TeamMembers.Add(new TeamMember { TeamId = 100, UserId = 15 });
        db.SaveChanges();
        return db;
    }

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
            .Select(i => (int)i.GetType().GetProperty("Id")!.GetValue(i)!).OrderBy(i => i).ToList();

    private static List<string> Prop(IActionResult result, string name) =>
        ((IEnumerable<object>)((ApiResponseDto<object>)((OkObjectResult)result).Value!).Data!)
            .SelectMany(i => (IEnumerable<string>)i.GetType().GetProperty(name)!.GetValue(i)!).OrderBy(s => s).ToList();

    // ── Teams ────────────────────────────────────────────────────────────────
    private static TeamsController Teams(AppDbContext db, int userId, string role) =>
        As(new TeamsController(db, new RolePermissionService(db)), userId, role);

    [Fact]
    public async Task Teams_TeamLeaderAndOperationManager_SeeOnlyTheirOwnTeams()
    {
        var db = Seed();
        Ids(await Teams(db, 14, "TeamLeader").GetAll(null)).Should().Equal(100);       // leads it
        Ids(await Teams(db, 15, "OperationManager").GetAll(null)).Should().Equal(100); // member of it
    }

    [Fact]
    public async Task Teams_LocationHead_SeesTheTeamsAtItsLocation()
    {
        Ids(await Teams(Seed(), 10, "LocationHead").GetAll(null)).Should().Equal(101);
    }

    [Fact]
    public async Task Teams_ProductTeamAndAdmin_SeeEveryTeam_ManagerUnchanged()
    {
        var db = Seed();
        Ids(await Teams(db, 30, "ProductTeam").GetAll(null)).Should().Equal(100, 101, 102);
        Ids(await Teams(db, 1, "Admin").GetAll(null)).Should().Equal(100, 101, 102);
        Ids(await Teams(db, 14, "Manager").GetAll(null)).Should().Equal(100);
    }

    [Fact]
    public void Teams_ReadRolesWidened_WritesStayAdminAndProductTeam()
    {
        Roles(typeof(TeamsController)).Should().BeEquivalentTo(
            "Admin", "Manager", "ProductTeam", "TeamLeader", "LocationHead", "OperationManager");
        foreach (var m in new[] { "Create", "Update", "SetStatus", "AddMember", "RemoveMember", "Delete" })
            Roles(typeof(TeamsController).GetMethod(m)!).Should().BeEquivalentTo("Admin", "ProductTeam");
    }

    // ── Locations ────────────────────────────────────────────────────────────
    private static LocationsController Locations(AppDbContext db, int userId, string role) =>
        As(new LocationsController(db, new RolePermissionService(db)), userId, role);

    [Fact]
    public async Task Locations_LocationHead_SeesOnlyItsOwnLocationAndItsUsers()
    {
        var result = await Locations(Seed(), 10, "LocationHead").GetAll();
        Ids(result).Should().Equal(1);
        Prop(result, "Users").Should().Equal("Sales L1", "Zonal");
    }

    [Fact]
    public async Task Locations_ReadThroughATeamMenu_AreStillScoped()
    {
        // TeamLeader has Team Overview but no Locations menu and no Location mapping.
        Ids(await Locations(Seed(), 14, "TeamLeader").GetAll()).Should().BeEmpty();
    }

    [Fact]
    public async Task Locations_ProductTeamAndManager_SeeAll_RoleWithoutAnyMenu_IsRefused()
    {
        var db = Seed();
        Ids(await Locations(db, 30, "ProductTeam").GetAll()).Should().Equal(1, 2);
        Ids(await Locations(db, 31, "Manager").GetAll()).Should().Equal(1, 2);
        (await Locations(db, 11, "Sales").GetAll()).Should().BeOfType<ForbidResult>();
    }

    // ── Users ────────────────────────────────────────────────────────────────
    private static readonly int[] AllUserIds = { 1, 10, 11, 12, 13, 14, 15 };

    private static (UsersController ctl, Mock<IUserService> svc) Users(AppDbContext db, int userId, string role)
    {
        var svc = new Mock<IUserService>();
        svc.Setup(s => s.GetAllAsync()).ReturnsAsync(ApiResponseDto<IEnumerable<UserDto>>.Ok(
            AllUserIds.Select(id => new UserDto { Id = id, FullName = $"U{id}" }).ToList()));
        svc.Setup(s => s.GetByIdAsync(It.IsAny<int>())).ReturnsAsync((int id) => ApiResponseDto<UserDto>.Ok(new UserDto { Id = id }));
        svc.Setup(s => s.UpdateAsync(It.IsAny<int>(), It.IsAny<UpdateUserRequestDto>()))
            .ReturnsAsync((int id, UpdateUserRequestDto _) => ApiResponseDto<UserDto>.Ok(new UserDto { Id = id }));
        svc.Setup(s => s.DeleteAsync(It.IsAny<int>())).ReturnsAsync(ApiResponseDto<bool>.Ok(true));
        svc.Setup(s => s.AdminResetPasswordAsync(It.IsAny<int>(), It.IsAny<AdminResetPasswordRequestDto>()))
            .ReturnsAsync(ApiResponseDto<bool>.Ok(true));
        var ctl = As(new UsersController(svc.Object, db, Mock.Of<IEmailService>(), new RolePermissionService(db)), userId, role);
        return (ctl, svc);
    }

    private static List<int> UserIds(IActionResult result) =>
        ((ApiResponseDto<IEnumerable<UserDto>>)((OkObjectResult)result).Value!).Data!.Select(u => u.Id).OrderBy(i => i).ToList();

    [Fact]
    public async Task Users_LocationHead_ListsOnlyUsersAtItsOwnLocation()
    {
        var (ctl, _) = Users(Seed(), 10, "LocationHead");
        UserIds(await ctl.GetAll()).Should().Equal(10, 11, 13);
        (await ctl.GetById(11)).Should().BeOfType<OkObjectResult>();
        (await ctl.GetById(12)).Should().BeOfType<NotFoundObjectResult>(); // other Location
    }

    [Fact]
    public async Task Users_ProductTeam_ListsEveryone()
    {
        var (ctl, _) = Users(Seed(), 30, "ProductTeam");
        UserIds(await ctl.GetAll()).Should().Equal(AllUserIds);
    }

    [Fact]
    public void Users_ReadAndManageRoles()
    {
        Roles(typeof(UsersController).GetMethod("GetAll")!).Should().BeEquivalentTo("Admin", "ProductTeam", "LocationHead");
        Roles(typeof(UsersController).GetMethod("GetById")!).Should().BeEquivalentTo("Admin", "ProductTeam", "LocationHead");
        foreach (var m in new[] { "Create", "Update", "SetPhoto", "SetStatus", "SetLocations", "SetTeams", "Delete", "AdminResetPassword" })
            Roles(typeof(UsersController).GetMethod(m)!).Should().BeEquivalentTo(new[] { "Admin", "ProductTeam" }, m);
    }

    private static void ShouldBe403(IActionResult r) =>
        r.Should().BeOfType<ObjectResult>().Which.StatusCode.Should().Be(StatusCodes.Status403Forbidden);

    [Fact]
    public async Task ProductTeam_CannotCreateOrManageAnAdmin()
    {
        var db = Seed();
        var (ctl, svc) = Users(db, 30, "ProductTeam");

        ShouldBe403(await ctl.Create(new CreateUserRequestDto { FullName = "X", Email = "x@x", Password = "secret1", Role = UserRole.Admin }));
        ShouldBe403(await ctl.Update(1, new UpdateUserRequestDto { FullName = "A", Role = UserRole.Admin, IsActive = true }));
        ShouldBe403(await ctl.Update(11, new UpdateUserRequestDto { FullName = "S", Role = UserRole.Admin, IsActive = true })); // promote
        ShouldBe403(await ctl.SetPhoto(1, new SetUserPhotoRequestDto()));
        ShouldBe403(await ctl.SetStatus(1, new SetUserStatusRequestDto { IsActive = false }));
        ShouldBe403(await ctl.SetLocations(1, new List<int>()));
        ShouldBe403(await ctl.SetTeams(1, new UsersController.SetTeamsRequestDto()));
        ShouldBe403(await ctl.Delete(1));
        ShouldBe403(await ctl.AdminResetPassword(1, new AdminResetPasswordRequestDto { NewPassword = "secret1" }));

        svc.Verify(s => s.CreateAsync(It.IsAny<CreateUserRequestDto>()), Times.Never);
        svc.Verify(s => s.UpdateAsync(It.IsAny<int>(), It.IsAny<UpdateUserRequestDto>()), Times.Never);
        svc.Verify(s => s.DeleteAsync(It.IsAny<int>()), Times.Never);
        (await db.Users.SingleAsync(u => u.Id == 1)).IsActive.Should().BeTrue();
    }

    [Fact]
    public async Task ProductTeam_ManagesNonAdminUsers_AndAdminStillManagesAdmins()
    {
        var db = Seed();
        var (pt, _) = Users(db, 30, "ProductTeam");
        (await pt.SetStatus(11, new SetUserStatusRequestDto { IsActive = false })).Should().BeOfType<OkObjectResult>();
        (await pt.Update(12, new UpdateUserRequestDto { FullName = "S2", Role = UserRole.TeamLeader, IsActive = true })).Should().BeOfType<OkObjectResult>();
        (await pt.Delete(13)).Should().BeOfType<OkObjectResult>();

        var (admin, _) = Users(db, 99, "Admin");
        (await admin.Update(1, new UpdateUserRequestDto { FullName = "A", Role = UserRole.Admin, IsActive = true })).Should().BeOfType<OkObjectResult>();
        (await admin.SetStatus(1, new SetUserStatusRequestDto { IsActive = true })).Should().BeOfType<OkObjectResult>();
    }

    private static string[] Roles(MemberInfo member) =>
        member.GetCustomAttributes<AuthorizeAttribute>().Single(a => a.Roles != null).Roles!
            .Split(',', StringSplitOptions.TrimEntries);
}
