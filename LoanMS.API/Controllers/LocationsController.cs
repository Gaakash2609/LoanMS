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

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "locations-mgmt"))
            return Forbid();

        var locs = await _db.Locations.OrderBy(l => l.Name)
            .Select(l => new { l.Id, l.Name, l.City, l.State, l.PinCode, l.IsActive, l.Code })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(locs));
    }

    [HttpPost]
    [Authorize(Roles = "Admin")]
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
    [Authorize(Roles = "Admin")]
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

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
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
