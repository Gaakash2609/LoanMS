namespace LoanMS.API.Services;

/// <summary>
/// See RolePermissionService for the full explanation. Checks the
/// Admin-configurable Roles and Permissions matrix (Settings screen) for a
/// specific role + permission key, on top of (never instead of) the
/// existing fixed [Authorize(Roles=...)] checks.
/// </summary>
public interface IRolePermissionService
{
    Task<bool> IsAllowedAsync(string? backendRole, string permissionKey);
    Task<bool> IsMenuAllowedAsync(string? backendRole, string menuId);
    /// <summary>
    /// Bulk version of IsAllowedAsync for the Loan-detail "Tab Data Access"
    /// masking (LoanService.MapToDto) — checking N permissions one-by-one
    /// would mean N separate settings-lookups per page-load; this reads the
    /// settings JSON once and checks every key against it. Returns the
    /// SUBSET of permissionKeys that are explicitly denied (fail-open — a
    /// key not in the result means "allowed", same convention as
    /// IsAllowedAsync).
    /// </summary>
    Task<HashSet<string>> GetDeniedPermissionsAsync(string? backendRole, IEnumerable<string> permissionKeys);
}
