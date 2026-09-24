using FluentAssertions;
using LoanMS.API.Services;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanMS.Tests.Services;

// ── Own-permissions read (roles audit R#3) ───────────────────────────────────
// Non-Admin UIs could never read the Admin-saved permission matrix (the generic
// settings read is Admin-only on purpose), so they silently ran on hard-coded
// defaults while the backend enforced the saved map. GET /api/users/me/permissions
// returns only the caller's OWN role slice; these tests pin that slice.
public class RolePermissionOwnPermissionsTests
{
    private static AppDbContext Db(params (string key, string value)[] settings)
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        foreach (var (key, value) in settings)
            db.AppSettings.Add(new AppSetting { Key = key, Value = value, Category = "Permissions" });
        db.SaveChanges();
        return db;
    }

    private const string Perms =
        "{\"sales_executive\":{\"canManageTasks\":false,\"canNavPayout\":true,\"label\":\"Sales\"}," +
        "\"manager\":{\"canManageTasks\":true,\"canNavUsers\":true}}";
    private const string Menus = "{\"payout\":[\"admin\",\"sales_executive\"],\"banks\":[\"admin\",\"manager\"]}";

    [Fact]
    public async Task NothingSaved_ReturnsRoleKey_AndNoOverrides()
    {
        var own = await new RolePermissionService(Db()).GetOwnPermissionsAsync("Sales");
        own.RoleKey.Should().Be("sales_executive");
        own.Permissions.Should().BeNull();          // frontend keeps its defaults
        own.MenuVisibility.Should().BeEmpty();
    }

    [Fact]
    public async Task ReturnsOnlyTheCallersOwnFlags_NeverOtherRoles()
    {
        var own = await new RolePermissionService(Db(("efin_role_permissions", Perms))).GetOwnPermissionsAsync("Sales");
        own.Permissions.Should().BeEquivalentTo(new Dictionary<string, bool>
        {
            ["canManageTasks"] = false,
            ["canNavPayout"] = true,                // non-boolean values are dropped
        });
        own.Permissions!.Keys.Should().NotContain("canNavUsers"); // manager's flag
    }

    [Fact]
    public async Task MenuVisibility_IsWhetherTheCallersRoleIsListed()
    {
        var svc = new RolePermissionService(Db(("efin_menu_visibility", Menus)));
        (await svc.GetOwnPermissionsAsync("Sales")).MenuVisibility.Should().BeEquivalentTo(
            new Dictionary<string, bool> { ["payout"] = true, ["banks"] = false });
        (await svc.GetOwnPermissionsAsync("Manager")).MenuVisibility.Should().BeEquivalentTo(
            new Dictionary<string, bool> { ["payout"] = false, ["banks"] = true });
    }

    [Fact]
    public async Task UnknownRole_OrMalformedJson_DegradesToDefaults_WithoutThrowing()
    {
        (await new RolePermissionService(Db(("efin_role_permissions", Perms))).GetOwnPermissionsAsync("Nobody"))
            .RoleKey.Should().BeNull();
        var broken = await new RolePermissionService(Db(("efin_role_permissions", "{not json"), ("efin_menu_visibility", "[1,"))).GetOwnPermissionsAsync("Sales");
        broken.RoleKey.Should().Be("sales_executive");
        broken.Permissions.Should().BeNull();
        broken.MenuVisibility.Should().BeEmpty();
    }
}
