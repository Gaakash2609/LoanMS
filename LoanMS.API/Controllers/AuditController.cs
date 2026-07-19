using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

[Authorize(Roles = "Admin")]
public class AuditController : BaseController
{
    private readonly AppDbContext _db;
    public AuditController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetLogs(
        [FromQuery] string? entity, [FromQuery] string? action,
        [FromQuery] int page = 1, [FromQuery] int pageSize = 50,
        [FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
    {
        var q = _db.AuditLogs.AsQueryable();
        if (!string.IsNullOrEmpty(entity)) q = q.Where(a => a.EntityName == entity);
        if (!string.IsNullOrEmpty(action)) q = q.Where(a => a.Action == action);
        if (from.HasValue) q = q.Where(a => a.CreatedAt >= from.Value);
        if (to.HasValue)   q = q.Where(a => a.CreatedAt <= to.Value.AddDays(1));

        var total = await q.CountAsync();
        var items = await q.OrderByDescending(a => a.CreatedAt)
            .Skip((page - 1) * pageSize).Take(pageSize)
            .Select(a => new AuditLogDto
            {
                Id         = a.Id,
                EntityName = a.EntityName,
                Action     = a.Action,
                EntityId   = a.EntityId,
                UserName   = a.UserName,
                OldValues  = a.OldValues,
                NewValues  = a.NewValues,
                CreatedAt  = a.CreatedAt
            }).ToListAsync();

        return Ok(ApiResponseDto<object>.Ok(new { items, total, page, pageSize,
            totalPages = (int)Math.Ceiling((double)total / pageSize) }));
    }
}
