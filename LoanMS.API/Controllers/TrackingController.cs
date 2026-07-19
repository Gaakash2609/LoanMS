using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

[Authorize]
public class TrackingController : BaseController
{
    private readonly AppDbContext _db;
    public TrackingController(AppDbContext db) => _db = db;

    [HttpGet("/api/loans/{loanId:int}/tracking")]
    public async Task<IActionResult> GetByLoan(int loanId)
    {
        var entries = await _db.TrackingEntries
            .Where(t => t.LoanId == loanId)
            .OrderBy(t => t.CreatedAt)
            .Select(t => new {
                t.Id, t.Name, t.Stage, t.AssignedUser,
                t.Status, t.Comment, t.SubNote, t.CreatedAt
            }).ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(entries));
    }

    [HttpPost("/api/loans/{loanId:int}/tracking")]
    public async Task<IActionResult> Add(int loanId, [FromBody] TrackingDto dto)
    {
        var entry = new TrackingEntry {
            LoanId = loanId, Name = dto.Name, Stage = dto.Stage,
            AssignedUser = dto.AssignedUser, Status = dto.Status ?? "Pending",
            Comment = dto.Comment, SubNote = dto.SubNote,
            CreatedByUserId = CurrentUserId, CreatedAt = DateTime.UtcNow
        };
        _db.TrackingEntries.Add(entry);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { entry.Id }, "Tracking entry added."));
    }

    [HttpPut("/api/tracking/{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] TrackingDto dto)
    {
        var entry = await _db.TrackingEntries.FindAsync(id);
        if (entry == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        entry.Name = dto.Name; entry.Stage = dto.Stage;
        entry.AssignedUser = dto.AssignedUser; entry.Status = dto.Status ?? entry.Status;
        entry.Comment = dto.Comment; entry.SubNote = dto.SubNote;
        entry.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Updated."));
    }

    [HttpDelete("/api/tracking/{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var entry = await _db.TrackingEntries.FindAsync(id);
        if (entry == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        entry.IsDeleted = true; entry.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Deleted."));
    }
}

public class TrackingDto {
    public string Name { get; set; } = string.Empty;
    public string Stage { get; set; } = string.Empty;
    public string AssignedUser { get; set; } = string.Empty;
    public string? Status { get; set; }
    public string? Comment { get; set; }
    public string? SubNote { get; set; }
}
