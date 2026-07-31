using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── Phase 5B — Banks: full database persistence ──────────────────────────────
// Mirrors LocationsController, the closest structural analog: same nav-role
// gating (Admin + Manager can view the page), same RBAC convention for
// mutations (destructive/write actions are Admin-only — Manager gets
// read-only access, matching how Locations is already enforced). This keeps
// RBAC consistent across the two simple "master data" screens rather than
// introducing a new pattern for Banks specifically.
[Authorize]
public class BanksController : BaseController
{
    private readonly AppDbContext _db;
    public BanksController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var banks = await _db.Banks
            .OrderBy(b => b.BankName)
            .Select(b => new
            {
                b.Id,
                b.BankName,
                b.IfscPrefix,
                b.EmpCode,
                b.Location,
                b.RmName,
                b.RmMobile,
                b.Email,
                b.Remarks,
                b.IsActive,
                b.CreatedAt,
                b.UpdatedAt
            })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(banks));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var bank = await _db.Banks.FindAsync(id);
        if (bank == null) return NotFound(ApiResponseDto<bool>.Fail("Bank not found."));
        return Ok(ApiResponseDto<BankMaster>.Ok(bank));
    }

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create([FromBody] BankDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.BankName))
            return BadRequest(ApiResponseDto<object>.Fail("Bank Name is required."));

        var name = dto.BankName.Trim();

        // Server-side duplicate check (case-insensitive) — the client-supplied
        // form data is never trusted for uniqueness; this is enforced here and
        // backed by the DB-level unique filtered index as a second guard.
        var exists = await _db.Banks.AnyAsync(b => b.BankName.ToLower() == name.ToLower());
        if (exists)
            return BadRequest(ApiResponseDto<object>.Fail("A bank with this name already exists."));

        var bank = new BankMaster
        {
            BankName = name,
            IfscPrefix = dto.IfscPrefix?.Trim(),
            EmpCode = dto.EmpCode?.Trim(),
            Location = dto.Location?.Trim(),
            RmName = dto.RmName?.Trim(),
            RmMobile = dto.RmMobile?.Trim(),
            Email = dto.Email?.Trim(),
            Remarks = dto.Remarks?.Trim(),
            IsActive = dto.IsActive ?? true,
            // Owner/creator is always taken from the authenticated JWT claim,
            // never from client-supplied input, per server-side identity rule.
            CreatedByUserId = CurrentUserId,
            CreatedAt = DateTime.UtcNow
        };

        try
        {
            _db.Banks.Add(bank);
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Race-condition fallback: two concurrent requests both passed the
            // AnyAsync check above but the unique index rejected the second insert.
            return BadRequest(ApiResponseDto<object>.Fail("A bank with this name already exists."));
        }

        return Ok(ApiResponseDto<object>.Ok(new { bank.Id }, "Bank created."));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Update(int id, [FromBody] BankDto dto)
    {
        var bank = await _db.Banks.FindAsync(id);
        if (bank == null) return NotFound(ApiResponseDto<bool>.Fail("Bank not found."));

        if (string.IsNullOrWhiteSpace(dto.BankName))
            return BadRequest(ApiResponseDto<object>.Fail("Bank Name is required."));

        var name = dto.BankName.Trim();
        var duplicate = await _db.Banks.AnyAsync(b => b.Id != id && b.BankName.ToLower() == name.ToLower());
        if (duplicate)
            return BadRequest(ApiResponseDto<object>.Fail("A bank with this name already exists."));

        bank.BankName = name;
        bank.IfscPrefix = dto.IfscPrefix?.Trim();
        bank.EmpCode = dto.EmpCode?.Trim();
        bank.Location = dto.Location?.Trim();
        bank.RmName = dto.RmName?.Trim();
        bank.RmMobile = dto.RmMobile?.Trim();
        bank.Email = dto.Email?.Trim();
        bank.Remarks = dto.Remarks?.Trim();
        if (dto.IsActive.HasValue) bank.IsActive = dto.IsActive.Value;
        bank.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Bank updated."));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var bank = await _db.Banks.FindAsync(id);
        if (bank == null) return NotFound(ApiResponseDto<bool>.Fail("Bank not found."));

        // Soft delete only — same convention as LocationsController/DsaController.
        // No FK relationships currently reference BankMaster, so nothing downstream
        // (loans/applications/payouts/reports) can be broken by this.
        bank.IsDeleted = true;
        bank.IsActive = false;
        bank.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Bank deleted."));
    }
}

public class BankDto
{
    public string BankName { get; set; } = string.Empty;
    public string? IfscPrefix { get; set; }
    public string? EmpCode { get; set; }
    public string? Location { get; set; }
    public string? RmName { get; set; }
    public string? RmMobile { get; set; }
    public string? Email { get; set; }
    public string? Remarks { get; set; }
    public bool? IsActive { get; set; }
}
