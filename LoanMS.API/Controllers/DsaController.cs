using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

[Authorize]
public class DsaController : BaseController
{
    private readonly AppDbContext _db;
    public DsaController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var dsa = await _db.DsaPartners.Include(d => d.MappedSalesUser)
            .OrderBy(d => d.Name)
            .Select(d => new {
                d.Id, d.Name, d.Code, d.Email, d.Phone,
                d.City, d.IsActive,
                MappedSalesUser = d.MappedSalesUser != null ? d.MappedSalesUser.FullName : null
            }).ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(dsa));
    }

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create([FromBody] DsaDto dto)
    {
        var dsa = new DsaPartner {
            Name = dto.Name, Code = dto.Code, Email = dto.Email,
            Phone = dto.Phone, City = dto.City, MappedSalesUserId = dto.MappedSalesUserId,
            CreatedAt = DateTime.UtcNow
        };
        _db.DsaPartners.Add(dsa);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { dsa.Id }, "DSA created."));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Update(int id, [FromBody] DsaDto dto)
    {
        var dsa = await _db.DsaPartners.FindAsync(id);
        if (dsa == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        dsa.Name = dto.Name; dsa.Code = dto.Code; dsa.Email = dto.Email;
        dsa.Phone = dto.Phone; dsa.City = dto.City;
        dsa.MappedSalesUserId = dto.MappedSalesUserId;
        dsa.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Updated."));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var dsa = await _db.DsaPartners.FindAsync(id);
        if (dsa == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        dsa.IsDeleted = true; dsa.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Deleted."));
    }
}

public class DsaDto {
    public string Name { get; set; } = string.Empty;
    public string Code { get; set; } = string.Empty;
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? City { get; set; }
    public int? MappedSalesUserId { get; set; }
}
