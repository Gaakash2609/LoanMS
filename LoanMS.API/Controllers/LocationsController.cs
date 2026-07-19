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
    public LocationsController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var locs = await _db.Locations.OrderBy(l => l.Name)
            .Select(l => new { l.Id, l.Name, l.City, l.State, l.PinCode, l.IsActive })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(locs));
    }

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create([FromBody] LocationDto dto)
    {
        var loc = new Location { Name = dto.Name, City = dto.City, State = dto.State, PinCode = dto.PinCode, CreatedAt = DateTime.UtcNow };
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
        loc.PinCode = dto.PinCode; loc.UpdatedAt = DateTime.UtcNow;
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
}
