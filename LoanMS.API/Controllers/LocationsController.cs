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

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin,ProductTeam")]
    public async Task<IActionResult> Delete(int id)
    {
        var loc = await _db.Locations.FindAsync(id);
        if (loc == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
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
