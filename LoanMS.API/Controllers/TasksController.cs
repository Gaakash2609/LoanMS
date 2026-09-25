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
    private readonly LoanMS.API.Services.IRolePermissionService _rolePerm;
    public TasksController(AppDbContext db, LoanMS.API.Services.IRolePermissionService rolePerm) { _db = db; _rolePerm = rolePerm; }

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] int? loanId, [FromQuery] bool? completed)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canViewTasks"))
            return Forbid();

        var q = _db.Tasks.IncludeDeletedUsers()
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
                IsPaused = t.PausedAt != null, t.PauseReason,
                AssignedTo = t.AssignedTo.FullName,
                CreatedBy  = t.CreatedBy.FullName,
                t.CreatedAt
            }).ToListAsync();

        return Ok(ApiResponseDto<object>.Ok(tasks));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] TaskCreateDto dto)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canManageTasks"))
            return Forbid();

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
        await _db.SaveChangesAsync(); // assigns task.Id, needed for the log entry below

        // Phase 5C: record the initial assignment. FromUserId is null — this is
        // a new task, not a reassignment. Actor (AssignedByUserId) is always the
        // authenticated creator, never taken from the request body.
        var assignee = await _db.Users.FindAsync(dto.AssignedToUserId);
        AssignmentLogHelper.Log(_db, "Task", task.Id, null, null,
            dto.AssignedToUserId, assignee?.FullName ?? "Unknown",
            CurrentUserId, CurrentUserEmail);
        await _db.SaveChangesAsync();

        return Ok(ApiResponseDto<object>.Ok(new { task.Id }, "Task created."));
    }

    [HttpPatch("{id:int}/reassign")]
    public async Task<IActionResult> Reassign(int id, [FromBody] TaskReassignDto dto)
    {
        var task = await _db.Tasks.IncludeDeletedUsers().Include(t => t.AssignedTo).FirstOrDefaultAsync(t => t.Id == id);
        if (task == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));

        // Parity with legacy confirmTaskTransfer (efin-app.js:23099): only the
        // current assignee, or a user with task-management permission, may
        // transfer a task. Backend-enforced — never relies on frontend hiding.
        var isManager = await _rolePerm.IsAllowedAsync(CurrentUserRole, "canManageTasks");
        if (task.AssignedToUserId != CurrentUserId && !isManager)
            return Forbid();

        // A pending deviation-approval task is moved with its deviation request
        // (Offers tab → reassign approver), which checks approver eligibility.
        if (await _db.OfferDeviations.AnyAsync(d => d.TaskId == id && d.Status == LoanMS.Domain.Entities.OfferWorkflowStatuses.RequestRaised))
            return Conflict(ApiResponseDto<bool>.Fail("This is a deviation-approval task — reassign it from the application's Offers tab.", ApiErrorCodes.WorkflowStage));

        var newAssignee = await _db.Users.FirstOrDefaultAsync(u => u.Id == dto.AssignedToUserId);
        if (newAssignee == null)
            return BadRequest(ApiResponseDto<bool>.Fail("Assigned user does not exist."));

        var fromUserId = task.AssignedToUserId;
        var fromName   = task.AssignedTo?.FullName;
        task.AssignedToUserId = dto.AssignedToUserId;
        task.UpdatedAt = DateTime.UtcNow;
        // Audit the reassignment (from → to); actor is always the authenticated
        // user, never taken from the request body — same pattern as Create.
        AssignmentLogHelper.Log(_db, "Task", task.Id, fromUserId, fromName,
            dto.AssignedToUserId, newAssignee.FullName, CurrentUserId, CurrentUserEmail);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { task.Id, AssignedTo = newAssignee.FullName },
            $"Task transferred to {newAssignee.FullName}."));
    }

    [HttpPatch("{id:int}/complete")]
    public async Task<IActionResult> Complete(int id)
    {
        var task = await _db.Tasks.FindAsync(id);
        if (task == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        // Same visibility rule as GetAll: outside Admin/Manager a user only sees
        // (and so may only complete/reopen) tasks assigned to or created by them.
        if (CurrentUserRole != "Admin" && CurrentUserRole != "Manager"
            && task.AssignedToUserId != CurrentUserId && task.CreatedByUserId != CurrentUserId)
            return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        if (task.PausedAt != null)
            return Conflict(ApiResponseDto<bool>.Fail($"This task is paused ({task.PauseReason ?? "application on hold"}) — un-hold the application first.", ApiErrorCodes.WorkflowStage));
        task.IsCompleted = !task.IsCompleted;
        task.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, task.IsCompleted ? "Completed." : "Reopened."));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        if (!await _rolePerm.IsAllowedAsync(CurrentUserRole, "canManageTasks"))
            return Forbid();

        var task = await _db.Tasks.FindAsync(id);
        if (task == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        // Same rule as the task list and Complete: outside Admin/Manager only
        // your own (assigned or created) tasks — a task you cannot see.
        if (CurrentUserRole != "Admin" && CurrentUserRole != "Manager"
            && task.AssignedToUserId != CurrentUserId && task.CreatedByUserId != CurrentUserId)
            return NotFound(ApiResponseDto<bool>.Fail("Not found."));
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

public class TaskReassignDto {
    public int AssignedToUserId { get; set; }
}
