using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── Rejection Reasons (Policy & Product page) — full database persistence ───
// Was frontend-only (rejection-reasons.js, localStorage key
// '_pp_rejection_reasons') — one admin's Add/Edit/Delete/Reorder never
// appeared for any other user/device. Mirrors BanksController: read open to
// any authenticated user (the Reject Application modal needs this for every
// role that can reject a loan), mutations Admin-only.
[Authorize]
public class RejectionReasonsController : BaseController
{
    private readonly AppDbContext _db;
    public RejectionReasonsController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var reasons = await _db.RejectionReasons
            .OrderBy(r => r.SortOrder).ThenBy(r => r.Label)
            .Select(r => new { r.Id, r.Key, r.Label, r.SortOrder, r.CreatedAt, r.UpdatedAt })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(reasons));
    }

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create([FromBody] RejectionReasonDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Label))
            return BadRequest(ApiResponseDto<object>.Fail("Label is required."));

        var key = string.IsNullOrWhiteSpace(dto.Key)
            ? System.Text.RegularExpressions.Regex.Replace(dto.Label.Trim().ToLower(), "[^a-z0-9]+", "_").Trim('_')
            : dto.Key.Trim().ToLower();

        var exists = await _db.RejectionReasons.AnyAsync(r => r.Key == key);
        if (exists)
            return BadRequest(ApiResponseDto<object>.Fail("A reason with this key already exists."));

        var maxOrder = await _db.RejectionReasons.Select(r => (int?)r.SortOrder).MaxAsync() ?? -1;

        var reason = new RejectionReason
        {
            Key = key,
            Label = dto.Label.Trim(),
            SortOrder = dto.SortOrder ?? (maxOrder + 1),
            CreatedByUserId = CurrentUserId,
            CreatedAt = DateTime.UtcNow
        };

        try
        {
            _db.RejectionReasons.Add(reason);
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return BadRequest(ApiResponseDto<object>.Fail("A reason with this key already exists."));
        }

        return Ok(ApiResponseDto<object>.Ok(new { reason.Id, reason.Key }, "Reason created."));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Update(int id, [FromBody] RejectionReasonDto dto)
    {
        var reason = await _db.RejectionReasons.FindAsync(id);
        if (reason == null) return NotFound(ApiResponseDto<bool>.Fail("Reason not found."));

        if (string.IsNullOrWhiteSpace(dto.Label))
            return BadRequest(ApiResponseDto<object>.Fail("Label is required."));

        reason.Label = dto.Label.Trim();
        if (dto.SortOrder.HasValue) reason.SortOrder = dto.SortOrder.Value;
        reason.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Reason updated."));
    }

    [HttpPut("reorder")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Reorder([FromBody] List<int> orderedIds)
    {
        var reasons = await _db.RejectionReasons.Where(r => orderedIds.Contains(r.Id)).ToListAsync();
        for (int i = 0; i < orderedIds.Count; i++)
        {
            var r = reasons.FirstOrDefault(x => x.Id == orderedIds[i]);
            if (r != null) { r.SortOrder = i; r.UpdatedAt = DateTime.UtcNow; }
        }
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Order updated."));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(int id)
    {
        var reason = await _db.RejectionReasons.FindAsync(id);
        if (reason == null) return NotFound(ApiResponseDto<bool>.Fail("Reason not found."));

        // Soft delete only — same convention as BanksController/DsaController.
        reason.IsDeleted = true;
        reason.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Reason deleted."));
    }
}

public class RejectionReasonDto
{
    public string? Key { get; set; }
    public string Label { get; set; } = string.Empty;
    public int? SortOrder { get; set; }
}
