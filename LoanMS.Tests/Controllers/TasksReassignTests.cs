using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.API.Services;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// Task transfer/reassignment (PATCH /api/tasks/{id}/reassign) — restores the
/// legacy confirmTaskTransfer behaviour on the server-backed architecture:
/// only the current assignee, or a user with canManageTasks, may transfer a
/// task; the assignment is re-pointed (and audited). canManageTasks is DENIED
/// in both tests so the assignee path is proven independent of that permission.
/// </summary>
public class TasksReassignTests
{
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static TasksController Controller(AppDbContext db, int currentUserId, bool allowManage)
    {
        var perm = new Mock<IRolePermissionService>();
        perm.Setup(r => r.IsAllowedAsync(It.IsAny<string?>(), It.IsAny<string>())).ReturnsAsync(allowManage);
        var claims = new ClaimsIdentity(new[]
        {
            new Claim("userId", currentUserId.ToString()),
            new Claim("role", "Sales"),
        }, "TestAuth");
        return new TasksController(db, perm.Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(claims) } }
        };
    }

    private static async Task<(int taskId, int assigneeId, int otherId)> SeedAsync(AppDbContext db)
    {
        var assignee = new User { FullName = "Assignee One", Email = "a1@efin.com", Role = UserRole.Sales, IsActive = true };
        var other    = new User { FullName = "Other Two",    Email = "o2@efin.com", Role = UserRole.Sales, IsActive = true };
        db.Users.AddRange(assignee, other);
        await db.SaveChangesAsync();

        var task = new LoanTask
        {
            Title = "Follow up with customer", Priority = "Medium",
            AssignedToUserId = assignee.Id, CreatedByUserId = assignee.Id, CreatedAt = DateTime.UtcNow
        };
        db.Tasks.Add(task);
        await db.SaveChangesAsync();
        return (task.Id, assignee.Id, other.Id);
    }

    [Fact]
    public async Task Reassign_ByCurrentAssignee_WithoutManagePermission_Succeeds_AndRepointsTask()
    {
        var db = NewDb();
        var (taskId, assigneeId, otherId) = await SeedAsync(db);

        var controller = Controller(db, currentUserId: assigneeId, allowManage: false);
        var result = await controller.Reassign(taskId, new TaskReassignDto { AssignedToUserId = otherId });

        result.Should().BeOfType<OkObjectResult>();
        (await db.Tasks.FindAsync(taskId))!.AssignedToUserId.Should().Be(otherId,
            "the current assignee may transfer, re-pointing the task");
    }

    [Fact]
    public async Task Reassign_ByNonAssignee_WithoutManagePermission_IsForbidden()
    {
        var db = NewDb();
        var (taskId, assigneeId, otherId) = await SeedAsync(db);

        // Acting user 999 is neither the assignee nor a task manager.
        var controller = Controller(db, currentUserId: 999, allowManage: false);
        var result = await controller.Reassign(taskId, new TaskReassignDto { AssignedToUserId = otherId });

        result.Should().BeOfType<ForbidResult>();
        (await db.Tasks.FindAsync(taskId))!.AssignedToUserId.Should().Be(assigneeId,
            "a forbidden request must not change the assignment");
    }

    [Fact]
    public async Task Reassign_ByManager_Succeeds_EvenIfNotAssignee()
    {
        var db = NewDb();
        var (taskId, _, otherId) = await SeedAsync(db);

        // Acting user 999 is not the assignee, but has canManageTasks.
        var controller = Controller(db, currentUserId: 999, allowManage: true);
        var result = await controller.Reassign(taskId, new TaskReassignDto { AssignedToUserId = otherId });

        result.Should().BeOfType<OkObjectResult>();
        (await db.Tasks.FindAsync(taskId))!.AssignedToUserId.Should().Be(otherId);
    }
}
