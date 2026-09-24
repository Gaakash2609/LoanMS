using System.Text.Json;
using FluentAssertions;
using LoanMS.API.Services;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanMS.Tests.Services;

// ── Fail-closed permission matrix (master prompt Part 4) ─────────────────────
// With the "efin_role_permissions" row missing, soft-deleted or corrupt, every
// non-Admin role used to be allowed everything. It must now get the secure
// per-role default (DEFAULT_ROLES, shipped as the embedded
// RolePermissionDefaults.json) — never wide open. Admin stays unrestricted.
public class RolePermissionFailClosedTests
{
    private const string PermKey = "efin_role_permissions";
    private const string MenuKey = "efin_menu_visibility";

    private static readonly string[] NonAdminRoles =
        { "Manager", "Sales", "Dsa", "Partner", "LoginTeam", "TeamLeader", "Accounts", "LocationHead", "OperationManager", "ProductTeam" };

    private static readonly Dictionary<string, string> RoleKey = new()
    {
        ["Manager"] = "manager", ["Sales"] = "sales_executive", ["Dsa"] = "dsa_user", ["Partner"] = "partner",
        ["LoginTeam"] = "login_team", ["TeamLeader"] = "team_leader", ["Accounts"] = "accounts",
        ["LocationHead"] = "location_head", ["OperationManager"] = "operation_manager", ["ProductTeam"] = "product_team",
    };

    // The shipped defaults, read straight from the API assembly's resource.
    private static readonly JsonElement Defaults = LoadDefaults();

    private static JsonElement LoadDefaults()
    {
        using var s = typeof(RolePermissionService).Assembly.GetManifestResourceStream("RolePermissionDefaults.json");
        s.Should().NotBeNull("the defaults must be embedded in LoanMS.API");
        return JsonDocument.Parse(s!).RootElement.Clone();
    }

    private static Dictionary<string, bool> DefaultFlags(string role) =>
        Defaults.GetProperty("roles").GetProperty(RoleKey[role]).EnumerateObject()
            .ToDictionary(p => p.Name, p => p.Value.GetBoolean());

    private static AppDbContext Db(params AppSetting[] rows)
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        db.AppSettings.AddRange(rows);
        db.SaveChanges();
        return db;
    }

    private static AppSetting Row(string key, string value, bool deleted = false) =>
        new() { Key = key, Value = value, Category = "Permissions", IsDeleted = deleted };

    public static IEnumerable<object[]> BrokenStores() => new[]
    {
        new object[] { "missing" },
        new object[] { "soft-deleted" },
        new object[] { "corrupt" },
        new object[] { "not-an-object" },
        new object[] { "empty" },
    };

    private static AppDbContext Store(string state) => state switch
    {
        "missing"       => Db(),
        // A saved row that everyone could use, but deleted — must not count.
        "soft-deleted"  => Db(Row(PermKey, AllOn(), deleted: true), Row(MenuKey, "{}", deleted: true)),
        "corrupt"       => Db(Row(PermKey, "{not json"), Row(MenuKey, "[1,")),
        "not-an-object" => Db(Row(PermKey, "[true]"), Row(MenuKey, "\"x\"")),
        "empty"         => Db(Row(PermKey, "  "), Row(MenuKey, "")),
        _ => throw new ArgumentOutOfRangeException(nameof(state)),
    };

    // Every role with every flag on — the wide-open state the old code produced.
    private static string AllOn() => JsonSerializer.Serialize(
        NonAdminRoles.ToDictionary(r => RoleKey[r], r => DefaultFlags(r).Keys.ToDictionary(k => k, _ => true)));

    [Theory]
    [MemberData(nameof(BrokenStores))]
    public async Task BrokenStore_EveryNonAdminRole_GetsItsSecureDefault_NotWideOpen(string state)
    {
        var svc = new RolePermissionService(Store(state));
        foreach (var role in NonAdminRoles)
        {
            var defaults = DefaultFlags(role);
            var denied = await svc.GetDeniedPermissionsAsync(role, defaults.Keys);
            denied.Should().BeEquivalentTo(defaults.Where(d => !d.Value).Select(d => d.Key), $"{role} with a {state} store");
            denied.Should().NotBeEmpty($"{role} must not be wide open with a {state} store");
            foreach (var (key, expected) in defaults)
                (await svc.IsAllowedAsync(role, key)).Should().Be(expected, $"{role}.{key} with a {state} store");
        }
    }

    [Theory]
    [MemberData(nameof(BrokenStores))]
    public async Task BrokenStore_KnownRestrictions_Hold(string state)
    {
        var svc = new RolePermissionService(Store(state));
        // Business rules from DEFAULT_ROLES that the old fail-open code ignored.
        (await svc.IsAllowedAsync("Sales", "canRejectApp")).Should().BeFalse();
        (await svc.IsAllowedAsync("Sales", "canDisburse")).Should().BeFalse();
        (await svc.IsAllowedAsync("Dsa", "canChangeStatus")).Should().BeFalse();
        (await svc.IsAllowedAsync("Accounts", "canCreateApp")).Should().BeFalse();
        (await svc.IsAllowedAsync("Sales", "canCreateApp")).Should().BeTrue();
        (await svc.IsMenuAllowedAsync("Sales", "dsa-mgmt")).Should().BeFalse();
        (await svc.IsMenuAllowedAsync("Sales", "users-mgmt")).Should().BeFalse();
        (await svc.IsMenuAllowedAsync("Manager", "dsa-mgmt")).Should().BeTrue();      // Part 2 canNavDSA
        (await svc.IsMenuAllowedAsync("Manager", "partner-mgmt")).Should().BeTrue();  // Part 2 canNavPartner
        (await svc.IsMenuAllowedAsync("Manager", "policy-product")).Should().BeFalse(); // no nav flag → menu list
        (await svc.IsMenuAllowedAsync("ProductTeam", "policy-product")).Should().BeTrue();
        (await svc.IsMenuAllowedAsync("Sales", "tickets")).Should().BeTrue();
    }

    [Theory]
    [MemberData(nameof(BrokenStores))]
    public async Task Admin_IsAlwaysUnrestricted(string state)
    {
        var svc = new RolePermissionService(Store(state));
        (await svc.IsAllowedAsync("Admin", "canRejectApp")).Should().BeTrue();
        (await svc.IsAllowedAsync("Admin", "someFutureKey")).Should().BeTrue();
        (await svc.IsMenuAllowedAsync("Admin", "users-mgmt")).Should().BeTrue();
        (await svc.IsMenuAllowedAsync("Admin", "some-future-menu")).Should().BeTrue();
        (await svc.GetDeniedPermissionsAsync("Admin", new[] { "canRejectApp", "x" })).Should().BeEmpty();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Mystery")]
    public async Task UnknownRole_IsDenied(string? role)
    {
        var svc = new RolePermissionService(Db(Row(PermKey, AllOn())));
        (await svc.IsAllowedAsync(role, "canCreateApp")).Should().BeFalse();
        (await svc.IsMenuAllowedAsync(role, "dashboard")).Should().BeFalse();
        (await svc.GetDeniedPermissionsAsync(role, new[] { "canCreateApp" })).Should().Contain("canCreateApp");
    }

    [Fact]
    public async Task UnknownKey_ForANonAdminRole_IsDenied()
    {
        var svc = new RolePermissionService(Db());
        (await svc.IsAllowedAsync("Manager", "someFutureKey")).Should().BeFalse();
        (await svc.IsMenuAllowedAsync("Manager", "some-future-menu")).Should().BeFalse();
    }

    [Fact]
    public async Task SavedValues_AlwaysWin_OverTheDefaults()
    {
        var perms = "{\"sales_executive\":{\"canRejectApp\":true,\"canCreateApp\":false}," +
                    "\"manager\":{\"canNavDSA\":false}}";
        var menus = "{\"policy-product\":[\"admin\",\"manager\"],\"dsa-mgmt\":[\"admin\",\"manager\"]}";
        var svc = new RolePermissionService(Db(Row(PermKey, perms), Row(MenuKey, menus)));

        (await svc.IsAllowedAsync("Sales", "canRejectApp")).Should().BeTrue();   // default false
        (await svc.IsAllowedAsync("Sales", "canCreateApp")).Should().BeFalse();  // default true
        // The canNav* flag decides first, like the sidebar — even though the
        // saved menu list names manager.
        (await svc.IsMenuAllowedAsync("Manager", "dsa-mgmt")).Should().BeFalse();
        // No nav flag for this menu → the saved menu list decides.
        (await svc.IsMenuAllowedAsync("Manager", "policy-product")).Should().BeTrue();
        (await svc.IsMenuAllowedAsync("ProductTeam", "policy-product")).Should().BeFalse();
    }

    [Fact]
    public async Task PartiallySavedMatrix_FillsEveryGapFromTheDefaults()
    {
        // Only sales_executive saved, and only one of its keys; a menu map
        // saved before a menu existed.
        var svc = new RolePermissionService(Db(
            Row(PermKey, "{\"sales_executive\":{\"canCreateApp\":true,\"canRejectApp\":\"yes\"}}"),
            Row(MenuKey, "{\"tickets\":[\"admin\"]}")));

        (await svc.IsAllowedAsync("Sales", "canDisburse")).Should().BeFalse();   // key missing → default
        (await svc.IsAllowedAsync("Sales", "canRejectApp")).Should().BeFalse();  // non-boolean → default
        (await svc.IsAllowedAsync("Dsa", "canChangeStatus")).Should().BeFalse(); // role missing → default
        (await svc.IsAllowedAsync("Manager", "canChangeStatus")).Should().BeTrue();
        (await svc.IsMenuAllowedAsync("Manager", "policy-product")).Should().BeFalse(); // menu missing → default list
        (await svc.IsMenuAllowedAsync("ProductTeam", "policy-product")).Should().BeTrue();
    }
}
