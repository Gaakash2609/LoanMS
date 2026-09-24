using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.API.Services;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace LoanMS.Tests.Controllers;

// ── Task delete scope (roles audit R#5) ──────────────────────────────────────
// Delete had only the canManageTasks gate — any task id could be deleted, even
// one the caller cannot see in its task list. It now follows the same rule as
// the list and Complete: outside Admin/Manager, only your own tasks.
public class TasksDeleteScopeTests
{
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static TasksController Controller(AppDbContext db, int userId, string role)
    {
        var perm = new Mock<IRolePermissionService>();
        perm.Setup(r => r.IsAllowedAsync(It.IsAny<string?>(), It.IsAny<string>())).ReturnsAsync(true);
        var claims = new ClaimsIdentity(new[] { new Claim("userId", userId.ToString()), new Claim("role", role) }, "TestAuth");
        return new TasksController(db, perm.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(claims) } }
        };
    }

    private static async Task<int> SeedTask(AppDbContext db, int ownerId)
    {
        var task = new LoanTask { Title = "Call customer", Priority = "Medium", AssignedToUserId = ownerId, CreatedByUserId = ownerId, CreatedAt = DateTime.UtcNow };
        db.Tasks.Add(task);
        await db.SaveChangesAsync();
        return task.Id;
    }

    [Fact]
    public async Task TeamLeader_CannotDelete_SomeoneElsesTask()
    {
        var db = NewDb();
        var id = await SeedTask(db, ownerId: 1);
        (await Controller(db, userId: 2, "TeamLeader").Delete(id)).Should().BeOfType<NotFoundObjectResult>();
        (await db.Tasks.FindAsync(id))!.IsDeleted.Should().BeFalse();
    }

    [Fact]
    public async Task TeamLeader_CanDelete_ItsOwnTask()
    {
        var db = NewDb();
        var id = await SeedTask(db, ownerId: 2);
        (await Controller(db, userId: 2, "TeamLeader").Delete(id)).Should().BeOfType<OkObjectResult>();
        (await db.Tasks.IgnoreQueryFilters().FirstAsync(t => t.Id == id)).IsDeleted.Should().BeTrue();
    }

    [Fact]
    public async Task Manager_CanDelete_AnyTask_AsItCanListThemAll()
    {
        var db = NewDb();
        var id = await SeedTask(db, ownerId: 1);
        (await Controller(db, userId: 2, "Manager").Delete(id)).Should().BeOfType<OkObjectResult>();
    }
}
