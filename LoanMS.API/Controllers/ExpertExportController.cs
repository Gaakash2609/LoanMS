using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text;
using System.Text.Json;

namespace LoanMS.API.Controllers;

/// <summary>
/// Role-based access control for the "Expert Export" feature.
/// Admin always has access. Additional roles/individual users can be granted
/// access from Settings -> Roles &amp; Permissions (Admin only). Every export
/// request is re-checked server-side — the frontend button is only a convenience,
/// never the actual gate (UI hiding alone is not sufficient authorization).
/// </summary>
[Authorize]
public class ExpertExportController : BaseController
{
    private const string KEY_ROLES = "expert_export_roles"; // JSON string[] of UserRole names, e.g. ["Admin","Manager"]
    private const string KEY_USERS = "expert_export_users"; // JSON int[] of individually-granted user IDs

    private readonly AppDbContext _db;

    public ExpertExportController(AppDbContext db) => _db = db;

    // ── Load current config; Admin role is always implicitly included ────────
    private async Task<(List<string> roles, List<int> userIds)> _loadConfig()
    {
        var rolesJson = await _db.AppSettings.Where(s => s.Key == KEY_ROLES && !s.IsDeleted)
            .Select(s => s.Value).FirstOrDefaultAsync();
        var usersJson = await _db.AppSettings.Where(s => s.Key == KEY_USERS && !s.IsDeleted)
            .Select(s => s.Value).FirstOrDefaultAsync();

        var roles = new List<string>();
        if (!string.IsNullOrWhiteSpace(rolesJson))
        {
            try { roles = JsonSerializer.Deserialize<List<string>>(rolesJson) ?? new(); }
            catch { roles = new(); }
        }
        if (!roles.Contains("Admin")) roles.Insert(0, "Admin"); // Admin is always allowed by default

        var userIds = new List<int>();
        if (!string.IsNullOrWhiteSpace(usersJson))
        {
            try { userIds = JsonSerializer.Deserialize<List<int>>(usersJson) ?? new(); }
            catch { userIds = new(); }
        }
        return (roles, userIds);
    }

    private async Task<bool> _isAllowed(int userId, string role)
    {
        var (roles, userIds) = await _loadConfig();
        if (roles.Contains(role, StringComparer.OrdinalIgnoreCase)) return true;
        if (userIds.Contains(userId)) return true;
        return false;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/expertexport/access — does the CURRENT user have access?
    // Any authenticated user may call this (needed so the frontend can decide
    // whether to show the button); it never reveals the full permission list.
    // ─────────────────────────────────────────────────────────────────────────
    [HttpGet("access")]
    public async Task<IActionResult> GetAccess()
    {
        var allowed = await _isAllowed(CurrentUserId, CurrentUserRole);
        return Ok(new { allowed });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/expertexport/config — full permission config (Admin only)
    // ─────────────────────────────────────────────────────────────────────────
    [Authorize(Roles = "Admin")]
    [HttpGet("config")]
    public async Task<IActionResult> GetConfig()
    {
        var (roles, userIds) = await _loadConfig();
        var users = await _db.Users
            .Where(u => userIds.Contains(u.Id) && !u.IsDeleted)
            .Select(u => new { id = u.Id, name = u.FullName, email = u.Email, role = u.Role.ToString() })
            .ToListAsync();

        var allUsers = await _db.Users
            .Where(u => !u.IsDeleted)
            .OrderBy(u => u.FullName)
            .Select(u => new { id = u.Id, name = u.FullName, email = u.Email, role = u.Role.ToString() })
            .ToListAsync();

        return Ok(new { roles, users, allUsers });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/expertexport/config — update permission config (Admin only)
    // Body: { roles: string[], userIds: int[] }
    // Changes take effect immediately (no caching) — the very next /access or
    // /data call re-reads the config fresh from the database.
    // ─────────────────────────────────────────────────────────────────────────
    [Authorize(Roles = "Admin")]
    [HttpPost("config")]
    public async Task<IActionResult> SaveConfig([FromBody] ExpertExportConfigDto dto)
    {
        var validRoles = Enum.GetNames(typeof(LoanMS.Domain.Enums.UserRole));
        var roles = (dto.Roles ?? new()).Where(r => validRoles.Contains(r, StringComparer.OrdinalIgnoreCase)).Distinct().ToList();
        var userIds = (dto.UserIds ?? new()).Distinct().ToList();

        await _upsert(KEY_ROLES, JsonSerializer.Serialize(roles));
        await _upsert(KEY_USERS, JsonSerializer.Serialize(userIds));
        await _db.SaveChangesAsync();

        return Ok(new { success = true, roles, userIds });
    }

    private async Task _upsert(string key, string value)
    {
        var existing = await _db.AppSettings.FirstOrDefaultAsync(s => s.Key == key);
        if (existing != null)
        {
            existing.Value = value; existing.Category = "expert_export";
            existing.UpdatedAt = DateTime.UtcNow; existing.IsDeleted = false;
        }
        else
        {
            _db.AppSettings.Add(new AppSetting { Key = key, Value = value, Category = "expert_export", CreatedAt = DateTime.UtcNow });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/expertexport/data — the actual protected export.
    // Returns 403 Forbidden (not just a hidden button) for unauthorized callers,
    // even if they hit this URL directly.
    // ─────────────────────────────────────────────────────────────────────────
    [HttpGet("data")]
    public async Task<IActionResult> GetData()
    {
        if (!await _isAllowed(CurrentUserId, CurrentUserRole))
            return Forbid();

        var rows = await _db.Loans
            .Include(l => l.Customer)
            .OrderByDescending(l => l.CreatedAt)
            .Select(l => new
            {
                l.LoanNumber,
                l.LoanType,
                l.Status,
                CustomerName = l.Customer.FullName,
                l.RequestedAmount,
                l.ApprovedAmount,
                l.CreatedAt
            })
            .ToListAsync();

        var sb = new StringBuilder();
        sb.AppendLine("Loan Number,Loan Type,Status,Customer Name,Requested Amount,Approved Amount,Created At");
        foreach (var r in rows)
        {
            sb.AppendLine(string.Join(",",
                _csv(r.LoanNumber), _csv(r.LoanType.ToString()), _csv(r.Status.ToString()),
                _csv(r.CustomerName), r.RequestedAmount, r.ApprovedAmount?.ToString() ?? "",
                r.CreatedAt.ToString("yyyy-MM-dd HH:mm")));
        }

        var bytes = Encoding.UTF8.GetBytes(sb.ToString());
        return File(bytes, "text/csv", $"expert-export-{DateTime.UtcNow:yyyyMMdd-HHmmss}.csv");
    }

    private static string _csv(string? v) => "\"" + (v ?? "").Replace("\"", "\"\"") + "\"";
}

public class ExpertExportConfigDto
{
    public List<string>? Roles { get; set; }
    public List<int>? UserIds { get; set; }
}
