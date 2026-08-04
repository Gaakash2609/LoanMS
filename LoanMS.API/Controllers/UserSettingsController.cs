using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── Per-User Settings ───────────────────────────────────────────────────────
// Sibling to SettingsController's generic Key/Value AppSettings pattern —
// same table, same shape (Key/Value/Category) — but for data that belongs to
// exactly ONE user, e.g. the User Profile page (Primary/Address/Bank details),
// which used to live only in efin-app.js's USER_PROFILES object and
// localStorage ('efin_user_profiles').
//
// Why a separate controller instead of adding actions to SettingsController:
// SettingsController is [Authorize(Roles = "Admin")] at the class level
// (Admin Master Control, Menu Visibility, InCred/AI/Email credentials — all
// organization-wide config, correctly Admin-only). A user's own profile is
// NOT admin-only — every logged-in user must be able to read/write their own
// profile. Stacking a method-level [Authorize] on top of a class-level
// [Authorize(Roles="Admin")] does not loosen it: ASP.NET Core combines
// multiple Authorize attributes with AND, not OR. So per-user settings need
// their own controller with its own (non-Admin-restricted) [Authorize].
//
// Security: every read/write is scoped to BaseController.CurrentUserId, taken
// from the JWT — NEVER from client input (same convention already used by
// AssignmentLog.AssignedByUserId) — so one user can never read or overwrite
// another user's settings, even by guessing/tampering with a key or id.
[Authorize]
[Route("api/user-settings")]
public class UserSettingsController : BaseController
{
    private readonly AppDbContext _db;

    public UserSettingsController(AppDbContext db)
    {
        _db = db;
    }

    // ── Get the current user's own value for a key (e.g. "efin_user_profile") ──
    [HttpGet("{key}")]
    public async Task<IActionResult> Get(string key)
    {
        if (CurrentUserId <= 0)
            return Unauthorized(ApiResponseDto<bool>.Fail("Invalid session."));

        var setting = await _db.AppSettings
            .FirstOrDefaultAsync(s => s.Key == key && s.UserId == CurrentUserId);

        if (setting == null)
            return NotFound(ApiResponseDto<bool>.Fail("Setting not found."));

        return Ok(ApiResponseDto<object>.Ok(new { setting.Key, setting.Value, setting.Category }));
    }

    // ── Save (upsert) the current user's own value for a key ──────────────────
    [HttpPost]
    public async Task<IActionResult> Upsert([FromBody] SettingDto dto)
    {
        if (CurrentUserId <= 0)
            return Unauthorized(ApiResponseDto<bool>.Fail("Invalid session."));
        if (string.IsNullOrWhiteSpace(dto.Key))
            return BadRequest(ApiResponseDto<bool>.Fail("Key is required."));

        var existing = await _db.AppSettings
            .FirstOrDefaultAsync(s => s.Key == dto.Key && s.UserId == CurrentUserId);

        if (existing != null)
        {
            existing.Value = dto.Value;
            existing.Category = dto.Category;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            _db.AppSettings.Add(new AppSetting
            {
                Key = dto.Key,
                Value = dto.Value,
                Category = dto.Category,
                UserId = CurrentUserId,
                CreatedAt = DateTime.UtcNow
            });
        }

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Setting saved."));
    }
}
