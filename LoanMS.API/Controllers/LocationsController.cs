using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

[Authorize]
public class LocationsController : BaseController
{
    private readonly AppDbContext _db;
    private readonly LoanMS.API.Services.IRolePermissionService _rolePerm;
    public LocationsController(AppDbContext db, LoanMS.API.Services.IRolePermissionService rolePerm) { _db = db; _rolePerm = rolePerm; }

    /// <summary>
    /// Locations list — enriched with each Location's mapped Sales Teams,
    /// Login Teams, and assigned Users (by name), mirroring the vanilla
    /// Locations page's hierarchy columns (efin-app.js twRenderLocations,
    /// line ~24703: `twSalesTeams.filter(t=>t.location===l.name)` /
    /// `twLoginTeams.filter(...)` / `twUsers.filter(u=>(u.locs||[]).includes(l.name))`).
    /// The client also uses these lists to block Delete when a Location is
    /// still in use (same guard as vanilla's twDeleteLocation), so this is
    /// the one call the page needs — no N+1 across /api/teams and /api/users.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "locations-mgmt"))
            return Forbid();

        var locs = await _db.Locations.OrderBy(l => l.Name)
            .Select(l => new { l.Id, l.Name, l.City, l.State, l.PinCode, l.IsActive, l.Code })
            .ToListAsync();

        var teams = await _db.Teams.Where(t => !t.IsDeleted && t.LocationId != null)
            .Select(t => new { t.LocationId, t.Name, t.Type })
            .ToListAsync();
        var userLocs = await _db.UserLocations.Where(ul => !ul.IsDeleted)
            .Select(ul => new { ul.LocationId, UserName = ul.User.FullName })
            .ToListAsync();

        var result = locs.Select(l => new
        {
            l.Id, l.Name, l.City, l.State, l.PinCode, l.IsActive, l.Code,
            SalesTeams = teams.Where(t => t.LocationId == l.Id && t.Type == "Sales").Select(t => t.Name).ToList(),
            LoginTeams = teams.Where(t => t.LocationId == l.Id && t.Type == "Login").Select(t => t.Name).ToList(),
            Users = userLocs.Where(u => u.LocationId == l.Id).Select(u => u.UserName).ToList(),
        });
        return Ok(ApiResponseDto<object>.Ok(result));
    }

    // Roles widened from Admin-only to Admin,ProductTeam across Create/
    // Update/SetStatus/Delete — matches vanilla's twCanManageUsers()
    // (efin-app.js:24863: role==='admin'||role==='product_team'), which
    // gates Rename/Delete, and the "locations-mgmt" menu's own default
    // role list (['admin','product_team']) that already lets ProductTeam
    // reach this page. Vanilla's twSaveLocation (Add) has no permission
    // check at all beyond page access, so Create needs no extra guard
    // either — ProductTeam already has page access by default.
    [HttpPost]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> Create([FromBody] LocationDto dto)
    {
        // Employee Code generation (MH-{ROLE}-{LOCATION}-{RANDOM4}) needs a
        // short Code per Location — auto-derive one if the Admin didn't
        // type one, same fallback the backfill migration used for existing
        // rows, so a newly-created Location never ends up with a blank
        // Code that would make every user at that Location fall back to "HO".
        var code = string.IsNullOrWhiteSpace(dto.Code)
            ? new string((dto.Name ?? "").Where(char.IsLetter).Take(3).ToArray()).ToUpperInvariant()
            : dto.Code.Trim().ToUpperInvariant();
        var loc = new Location { Name = dto.Name, City = dto.City, State = dto.State, PinCode = dto.PinCode, Code = code, CreatedAt = DateTime.UtcNow };
        _db.Locations.Add(loc);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { loc.Id }, "Location created."));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> Update(int id, [FromBody] LocationDto dto)
    {
        var loc = await _db.Locations.FindAsync(id);
        if (loc == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        // BUGFIX (confirmed real gap — rename left users' Location stale):
        // User.LocationName is a free-text COPY of the Location name (written
        // by the Users form), not a live join like Team.Location.Name — so
        // renaming a Location here previously left every assigned user showing
        // the OLD name, which then broke the Users page's exact-string
        // Location filter (a rename made those users un-findable by the new
        // name). Propagate the rename to the copies now. Matched on the OLD
        // name; guarded so it only runs on an actual rename. The authoritative
        // LocationId/UserLocations links are unaffected (they key on id), so
        // this is purely fixing the display/filter copy.
        var oldName = loc.Name;
        if (!string.IsNullOrWhiteSpace(dto.Name) && !string.Equals(oldName, dto.Name, StringComparison.Ordinal))
        {
            var affectedUsers = await _db.Users.Where(u => u.LocationName == oldName && !u.IsDeleted).ToListAsync();
            foreach (var u in affectedUsers) { u.LocationName = dto.Name; u.UpdatedAt = DateTime.UtcNow; }
        }
        loc.Name = dto.Name; loc.City = dto.City; loc.State = dto.State;
        loc.PinCode = dto.PinCode;
        // Code is intentionally editable here — unlike a User's own
        // EmployeeCode (immutable once assigned), a Location's Code is a
        // small, Admin-correctable label. Existing users already assigned
        // an EmployeeCode built from the OLD Code keep it unchanged (Users
        // are never touched here) — only future Employee Codes generated
        // for this Location use the new Code.
        if (!string.IsNullOrWhiteSpace(dto.Code)) loc.Code = dto.Code.Trim().ToUpperInvariant();
        loc.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Updated."));
    }

    /// <summary>
    /// Archive/Restore a Location [Admin/ProductTeam — same roles as Update
    /// above, matching vanilla's twCanManageUsers() gate used for
    /// Rename/Delete (efin-app.js:24863: role==='admin'||role==='product_team')].
    /// Location.IsActive already exists on the entity and is already
    /// returned by GetAll (confirmed by inspection), it just had no way to
    /// be SET — LocationDto (the general Update() request-shape) never
    /// exposed it, and Update() itself never touched loc.IsActive at all.
    /// No migration needed — the column was already there. Touches only
    /// IsActive, leaving Name/City/State/PinCode/Code (Update()'s own
    /// fields) untouched.
    /// </summary>
    public class SetLocationStatusRequestDto { public bool IsActive { get; set; } }

    [HttpPatch("{id:int}/status")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> SetStatus(int id, [FromBody] SetLocationStatusRequestDto request)
    {
        var loc = await _db.Locations.FindAsync(id);
        if (loc == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        loc.IsActive = request.IsActive;
        loc.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Status updated."));
    }

    // BUGFIX (confirmed real gap — deleted Location kept granting access):
    // the frontend already refuses to delete a Location that's still used by
    // any team/user ("Cannot delete ... Reassign them first" — LocationsPage.
    // tsx onDelete), but that check only ever ran against its own cached list
    // and nothing enforced it server-side — a stale cache, or any direct API
    // call, could soft-delete a Location while Teams.LocationId and
    // UserLocations/User.LocationId still pointed at it. Location has a
    // global query filter (!IsDeleted), so the row then silently vanished
    // from every list/lookup — but LoanRepository.ApplyVisibilityScope's
    // LocationHead branch reads UserLocations directly, never joins back to
    // Location, so an orphaned LocationHead kept FULL, invisible-to-admins
    // loan visibility forever. Making the frontend's own intended rule
    // authoritative here, not inventing a new one.
    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> Delete(int id)
    {
        var loc = await _db.Locations.FindAsync(id);
        if (loc == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));

        var teamCount = await _db.Teams.CountAsync(t => t.LocationId == id && !t.IsDeleted);
        var userCount = await _db.UserLocations.CountAsync(ul => ul.LocationId == id && !ul.IsDeleted);
        if (teamCount > 0 || userCount > 0)
            return BadRequest(ApiResponseDto<bool>.Fail(
                $"Cannot delete \"{loc.Name}\" — it is used by {teamCount} team(s) and {userCount} user(s). Reassign them first."));

        loc.IsDeleted = true; loc.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Deleted."));
    }
}

public class LocationDto {
    public string Name { get; set; } = string.Empty;
    public string City { get; set; } = string.Empty;
    public string State { get; set; } = string.Empty;
    public string? PinCode { get; set; }
    public string? Code { get; set; }
}
