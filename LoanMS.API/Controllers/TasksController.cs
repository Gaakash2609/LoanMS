using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

[Authorize]
public class TasksController : BaseController
{
    private readonly AppDbContext _db;
    public TasksController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] int? loanId, [FromQuery] bool? completed)
    {
        var q = _db.Tasks
            .Include(t => t.AssignedTo)
            .Include(t => t.CreatedBy)
            .AsQueryable();

        if (loanId.HasValue) q = q.Where(t => t.LoanId == loanId);
        if (completed.HasValue) q = q.Where(t => t.IsCompleted == completed.Value);

        if (CurrentUserRole != "Admin" && CurrentUserRole != "Manager")
            q = q.Where(t => t.AssignedToUserId == CurrentUserId || t.CreatedByUserId == CurrentUserId);

        var tasks = await q.OrderByDescending(t => t.CreatedAt)
            .Select(t => new {
                t.Id, t.Title, t.Description, t.Priority,
                t.IsCompleted, t.DueDate, t.LoanId,
                AssignedTo = t.AssignedTo.FullName,
                CreatedBy  = t.CreatedBy.FullName,
                t.CreatedAt
            }).ToListAsync();

        return Ok(ApiResponseDto<object>.Ok(tasks));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] TaskCreateDto dto)
    {
        // Validate that the assigned user exists — prevents FK violation
        var assigneeExists = await _db.Users.AnyAsync(u => u.Id == dto.AssignedToUserId);
        if (!assigneeExists)
            return BadRequest(ApiResponseDto<object>.Fail("Assigned user does not exist."));

        var task = new LoanTask {
            Title = dto.Title, Description = dto.Description,
            Priority = dto.Priority ?? "Medium", DueDate = dto.DueDate,
            LoanId = dto.LoanId, AssignedToUserId = dto.AssignedToUserId,
            CreatedByUserId = CurrentUserId, CreatedAt = DateTime.UtcNow
        };
        _db.Tasks.Add(task);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { task.Id }, "Task created."));
    }

    [HttpPatch("{id:int}/complete")]
    public async Task<IActionResult> Complete(int id)
    {
        var task = await _db.Tasks.FindAsync(id);
        if (task == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        task.IsCompleted = !task.IsCompleted;
        task.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, task.IsCompleted ? "Completed." : "Reopened."));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var task = await _db.Tasks.FindAsync(id);
        if (task == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        task.IsDeleted = true; task.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Deleted."));
    }
}

public class TaskCreateDto {
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Priority { get; set; }
    public DateTime? DueDate { get; set; }
    public int? LoanId { get; set; }
    public int AssignedToUserId { get; set; }
}
