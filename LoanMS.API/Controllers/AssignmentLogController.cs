using LoanMS.Application.DTOs;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── Phase 5C — Assignment Log: read-only API ──────────────────────────────────
// Entries are NEVER created via a client-facing endpoint — they're written
// server-side only, from within TasksController.Create and
// TicketsController.Create/Update, using AssignedByUserId = CurrentUserId
// (the authenticated JWT claim). There is deliberately no POST/PUT/DELETE
// here: a client can read the history but can never forge, edit, or erase it.
[Authorize(Roles = "Admin,Manager")]
public class AssignmentLogController : BaseController
{
    private readonly AppDbContext _db;
    public AssignmentLogController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] string? entityType,
        [FromQuery] int? entityId,
        [FromQuery] int take = 100)
    {
        var q = _db.AssignmentLogs.AsQueryable();
        if (!string.IsNullOrWhiteSpace(entityType)) q = q.Where(a => a.EntityType == entityType);
        if (entityId.HasValue) q = q.Where(a => a.EntityId == entityId.Value);

        var capped = Math.Clamp(take, 1, 500);
        var logs = await q.OrderByDescending(a => a.CreatedAt)
            .Take(capped)
            .Select(a => new
            {
                a.Id,
                a.EntityType,
                a.EntityId,
                a.FromUserId,
                a.FromUserName,
                a.ToUserId,
                a.ToUserName,
                a.AssignedByUserId,
                a.AssignedByName,
                a.Notes,
                a.CreatedAt
            })
            .ToListAsync();

        return Ok(ApiResponseDto<object>.Ok(logs));
    }
}
