using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace LoanMS.API.Services;

/// <summary>
/// Server-side enforcement for the Admin-configurable permission matrix
/// (Settings -> Roles and Permissions) and the Menu Access Control map. Reads
/// the same AppSettings rows the frontend writes ("efin_role_permissions":
/// { "sales_executive": { "canRejectApp": false, ... } }, and
/// "efin_menu_visibility": { "dsa-mgmt": ["admin", ...] }).
///
/// FAILS CLOSED (business-owner decision 2026-09-24, master prompt Part 4).
/// It used to allow everything whenever a matrix had never been saved, was
/// unreadable, or lacked a key — so an install where the Admin never pressed
/// Save had no backend restriction at all. Now every missing value falls back
/// to the secure per-role default in RolePermissionDefaults.json, which is
/// generated from the frontend's DEFAULT_ROLES / ALL_MENU_ITEMS /
/// NAV_PERM_KEY_BY_MENU_ID (frontend/scripts/export-role-permission-defaults.ts;
/// a frontend test fails if the two drift). A value the Admin saved always
/// wins. Admin is never restricted; an unknown role is denied.
/// </summary>
public class RolePermissionService : IRolePermissionService
{
    private readonly AppDbContext _db;

    private const string SettingKey = "efin_role_permissions";
    private const string MenuVisKey = "efin_menu_visibility";

    // Backend UserRole enum name -> frontend ROLES config key (same mapping as
    // ROLE_MAP in api-bridge.js / BACKEND_TO_ROLE_KEY in constants/permissions.ts).
    private static readonly Dictionary<string, string> RoleKeyMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Admin"] = "admin",
        ["Manager"] = "manager",
        ["Sales"] = "sales_executive",
        ["Dsa"] = "dsa_user",
        ["Partner"] = "partner",
        ["LoginTeam"] = "login_team",
        ["TeamLeader"] = "team_leader",
        ["Accounts"] = "accounts",
        ["LocationHead"] = "location_head",
        ["OperationManager"] = "operation_manager",
        ["ProductTeam"] = "product_team",
    };

    public RolePermissionService(AppDbContext db) => _db = db;

    // ── Secure defaults ──────────────────────────────────────────────────────
    internal sealed class PermissionDefaults
    {
        public Dictionary<string, Dictionary<string, bool>> Roles { get; init; } = new();
        public Dictionary<string, string[]> Menus { get; init; } = new();
        public Dictionary<string, string> NavKeyByMenuId { get; init; } = new();
    }

    private static readonly Lazy<PermissionDefaults> Defaults = new(() =>
    {
        using var stream = typeof(RolePermissionService).Assembly.GetManifestResourceStream("RolePermissionDefaults.json")
            ?? throw new InvalidOperationException("Embedded resource RolePermissionDefaults.json is missing.");
        return JsonSerializer.Deserialize<PermissionDefaults>(stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException("RolePermissionDefaults.json is empty.");
    });

    internal static PermissionDefaults DefaultSet => Defaults.Value;

    private static bool IsAdmin(string? backendRole) =>
        string.Equals(backendRole, "Admin", StringComparison.OrdinalIgnoreCase);

    private static string? RoleKeyFor(string? backendRole) =>
        !string.IsNullOrWhiteSpace(backendRole) && RoleKeyMap.TryGetValue(backendRole, out var k) ? k : null;

    // ── Saved matrices (null = never saved or unreadable → defaults apply) ──
    private async Task<string?> ReadSettingAsync(string key) =>
        await _db.Set<LoanMS.Domain.Entities.AppSetting>()
            .AsNoTracking()
            .Where(s => s.Key == key && s.UserId == null && !s.IsDeleted)
            .Select(s => s.Value)
            .FirstOrDefaultAsync();

    /// <summary>The saved boolean flags of one role, or null.</summary>
    private async Task<Dictionary<string, bool>?> SavedFlagsAsync(string roleKey)
    {
        var json = await ReadSettingAsync(SettingKey);
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object ||
                !doc.RootElement.TryGetProperty(roleKey, out var roleObj) ||
                roleObj.ValueKind != JsonValueKind.Object)
                return null;
            var flags = new Dictionary<string, bool>();
            foreach (var p in roleObj.EnumerateObject())
                if (p.Value.ValueKind is JsonValueKind.True or JsonValueKind.False)
                    flags[p.Name] = p.Value.GetBoolean();
            return flags;
        }
        catch (JsonException) { return null; }
    }

    /// <summary>The saved menu-visibility map (menu id → role keys), or null.</summary>
    private async Task<Dictionary<string, List<string>>?> SavedMenusAsync()
    {
        var json = await ReadSettingAsync(MenuVisKey);
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return null;
            var menus = new Dictionary<string, List<string>>();
            foreach (var item in doc.RootElement.EnumerateObject())
                if (item.Value.ValueKind == JsonValueKind.Array)
                    menus[item.Name] = item.Value.EnumerateArray()
                        .Where(v => v.ValueKind == JsonValueKind.String)
                        .Select(v => v.GetString()!)
                        .ToList();
            return menus;
        }
        catch (JsonException) { return null; }
    }

    /// <summary>Saved value if the Admin saved one for this key, else the secure default.</summary>
    private static bool? EffectiveFlag(string roleKey, string key, Dictionary<string, bool>? saved)
    {
        if (saved != null && saved.TryGetValue(key, out var v)) return v;
        return DefaultSet.Roles.TryGetValue(roleKey, out var d) && d.TryGetValue(key, out var dv) ? dv : null;
    }

    public async Task<bool> IsAllowedAsync(string? backendRole, string permissionKey)
    {
        if (IsAdmin(backendRole)) return true;
        var roleKey = RoleKeyFor(backendRole);
        if (roleKey == null) return false;
        return EffectiveFlag(roleKey, permissionKey, await SavedFlagsAsync(roleKey)) == true;
    }

    public async Task<HashSet<string>> GetDeniedPermissionsAsync(string? backendRole, IEnumerable<string> permissionKeys)
    {
        var keys = permissionKeys.ToList();
        if (IsAdmin(backendRole)) return new HashSet<string>();
        var roleKey = RoleKeyFor(backendRole);
        if (roleKey == null) return keys.ToHashSet();
        var saved = await SavedFlagsAsync(roleKey);
        return keys.Where(k => EffectiveFlag(roleKey, k, saved) != true).ToHashSet();
    }

    /// <summary>
    /// Same precedence as the sidebar (hooks/usePermissions canAccessMenuItem,
    /// Vanilla applySession): the menu's dedicated canNav* flag wins when the
    /// role has one; otherwise the Menu Access Control role list decides.
    /// </summary>
    public async Task<bool> IsMenuAllowedAsync(string? backendRole, string menuId)
    {
        if (IsAdmin(backendRole)) return true;
        var roleKey = RoleKeyFor(backendRole);
        if (roleKey == null) return false;

        if (DefaultSet.NavKeyByMenuId.TryGetValue(menuId, out var navKey))
        {
            var flag = EffectiveFlag(roleKey, navKey, await SavedFlagsAsync(roleKey));
            if (flag.HasValue) return flag.Value;
        }
        var savedMenus = await SavedMenusAsync();
        if (savedMenus != null && savedMenus.TryGetValue(menuId, out var roles))
            return roles.Contains(roleKey, StringComparer.OrdinalIgnoreCase);
        return DefaultSet.Menus.TryGetValue(menuId, out var defaultRoles) &&
               defaultRoles.Contains(roleKey, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// The caller's OWN slice of the Admin-saved matrices, so a non-Admin UI
    /// can apply what the Admin saved (the generic settings read is Admin-only
    /// on purpose): the saved flags for the caller's role (null when none were
    /// saved) and, for each menu id in the saved menu visibility map, whether
    /// the caller's role is listed. Other roles' configuration is never
    /// returned. The frontend merges this over the same defaults the backend
    /// falls back to.
    /// </summary>
    public async Task<OwnPermissions> GetOwnPermissionsAsync(string? backendRole)
    {
        var roleKey = RoleKeyFor(backendRole);
        if (roleKey == null) return new OwnPermissions(null, null, new Dictionary<string, bool>());
        var menus = (await SavedMenusAsync() ?? new Dictionary<string, List<string>>())
            .ToDictionary(m => m.Key, m => m.Value.Contains(roleKey, StringComparer.OrdinalIgnoreCase));
        return new OwnPermissions(roleKey, await SavedFlagsAsync(roleKey), menus);
    }
}

/// <summary>See RolePermissionService.GetOwnPermissionsAsync.</summary>
public sealed record OwnPermissions(
    string? RoleKey,
    Dictionary<string, bool>? Permissions,
    Dictionary<string, bool> MenuVisibility);
