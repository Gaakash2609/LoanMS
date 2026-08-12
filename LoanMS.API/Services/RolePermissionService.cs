using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace LoanMS.API.Services;

/// <summary>
/// Server-side enforcement for the Admin-configurable permission matrix
/// (Settings -> Roles and Permissions). Previously this screen only ever
/// controlled frontend UI visibility -- an Admin could untick, say, "Reject
/// Application" for Manager, and Managers would correctly lose the button,
/// but a Manager calling the API directly would still succeed, since
/// backend authorization only checked the fixed [Authorize(Roles=...)]
/// role-name list, never this per-role customization. This service reads
/// the EXACT SAME AppSettings row ("efin_role_permissions") the frontend
/// already writes to (see stgSaveRolePermissions in efin-app.js) -- same
/// JSON shape: { "sales_executive": { "canRejectApp": false, ... }, ... }.
///
/// Deliberately fails OPEN (returns true / "allowed") whenever the setting
/// is missing, unparseable, or doesn't mention this role/permission at
/// all -- matching the existing default-allow behaviour so a fresh install
/// or an Admin who's never touched this screen sees zero behaviour change.
/// Only an EXPLICIT false saved by an Admin actually restricts anything.
/// Admin role itself is never restricted, matching the frontend's own
/// convention (Admin implicitly has every permission).
/// </summary>
public class RolePermissionService : IRolePermissionService
{
    private readonly AppDbContext _db;

    private const string SettingKey = "efin_role_permissions";

    // Backend UserRole enum name -> frontend ROLES config key. Must stay in
    // sync with ROLE_MAP in api-bridge.js -- same mapping, just needed here
    // too since this is the one place backend code needs to speak the
    // frontend's snake_case role vocabulary.
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

    private const string MenuVisKey = "efin_menu_visibility";

    /// <summary>
    /// "Menu Access Control" — a different saved shape from the permission
    /// matrix above: { "dsa-mgmt": ["admin","team_leader","product_team"],
    /// ... } (menu-id -> array of allowed frontend role-keys), see
    /// stgPushMenuVisibilityToServer in efin-app.js. Same fail-open
    /// philosophy: missing setting, missing menuId entry, or unparseable
    /// JSON all default to allowed=true.
    /// </summary>
    public async Task<bool> IsMenuAllowedAsync(string? backendRole, string menuId)
    {
        if (string.IsNullOrWhiteSpace(backendRole)) return true;
        if (string.Equals(backendRole, "Admin", StringComparison.OrdinalIgnoreCase)) return true;
        if (!RoleKeyMap.TryGetValue(backendRole, out var roleKey)) return true;

        try
        {
            var setting = await _db.Set<LoanMS.Domain.Entities.AppSetting>()
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.Key == MenuVisKey && s.UserId == null && !s.IsDeleted);
            if (setting == null || string.IsNullOrWhiteSpace(setting.Value)) return true;

            using var doc = JsonDocument.Parse(setting.Value);
            if (!doc.RootElement.TryGetProperty(menuId, out var arr)) return true;
            if (arr.ValueKind != JsonValueKind.Array) return true;

            foreach (var item in arr.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String &&
                    string.Equals(item.GetString(), roleKey, StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        }
        catch
        {
            return true;
        }
    }

    public async Task<HashSet<string>> GetDeniedPermissionsAsync(string? backendRole, IEnumerable<string> permissionKeys)
    {
        var denied = new HashSet<string>();
        if (string.IsNullOrWhiteSpace(backendRole)) return denied;
        if (string.Equals(backendRole, "Admin", StringComparison.OrdinalIgnoreCase)) return denied;
        if (!RoleKeyMap.TryGetValue(backendRole, out var roleKey)) return denied;

        try
        {
            var setting = await _db.Set<LoanMS.Domain.Entities.AppSetting>()
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.Key == SettingKey && s.UserId == null && !s.IsDeleted);
            if (setting == null || string.IsNullOrWhiteSpace(setting.Value)) return denied;

            using var doc = JsonDocument.Parse(setting.Value);
            if (!doc.RootElement.TryGetProperty(roleKey, out var roleObj)) return denied;

            foreach (var key in permissionKeys)
            {
                if (roleObj.TryGetProperty(key, out var permVal) &&
                    (permVal.ValueKind == JsonValueKind.False || permVal.ValueKind == JsonValueKind.True) &&
                    !permVal.GetBoolean())
                {
                    denied.Add(key);
                }
            }
            return denied;
        }
        catch
        {
            return denied; // fail open — same reasoning as IsAllowedAsync
        }
    }

    public async Task<bool> IsAllowedAsync(string? backendRole, string permissionKey)
    {
        if (string.IsNullOrWhiteSpace(backendRole)) return true;
        if (string.Equals(backendRole, "Admin", StringComparison.OrdinalIgnoreCase)) return true;
        if (!RoleKeyMap.TryGetValue(backendRole, out var roleKey)) return true;

        try
        {
            var setting = await _db.Set<LoanMS.Domain.Entities.AppSetting>()
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.Key == SettingKey && s.UserId == null && !s.IsDeleted);
            if (setting == null || string.IsNullOrWhiteSpace(setting.Value)) return true;

            using var doc = JsonDocument.Parse(setting.Value);
            if (!doc.RootElement.TryGetProperty(roleKey, out var roleObj)) return true;
            if (!roleObj.TryGetProperty(permissionKey, out var permVal)) return true;
            if (permVal.ValueKind != JsonValueKind.False && permVal.ValueKind != JsonValueKind.True) return true;

            return permVal.GetBoolean();
        }
        catch
        {
            // Malformed/unexpected JSON -- fail open rather than locking
            // everyone out over a settings-save glitch.
            return true;
        }
    }
}
