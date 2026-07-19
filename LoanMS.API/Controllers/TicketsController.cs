using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

[Authorize]
public class TicketsController : BaseController
{
    private readonly AppDbContext _db;
    public TicketsController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? status)
    {
        var q = _db.Tickets.Include(t => t.CreatedBy).Include(t => t.AssignedTo).AsQueryable();
        if (!string.IsNullOrEmpty(status)) q = q.Where(t => t.Status == status);

        // Scope: Sales, partner, and dsa_user see only their own tickets
        if (CurrentUserRole == "Sales" ||
            CurrentUserRole == "partner" ||
            CurrentUserRole == "dsa_user")
            q = q.Where(t => t.CreatedByUserId == CurrentUserId);

        var tickets = await q.OrderByDescending(t => t.CreatedAt)
            .Select(t => new {
                t.Id, t.Title, t.Description, t.Status, t.Priority,
                t.LoanId, CreatedBy = t.CreatedBy.FullName,
                AssignedTo = t.AssignedTo != null ? t.AssignedTo.FullName : null,
                t.CreatedAt, t.ClosedAt
            }).ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(tickets));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] TicketCreateDto dto)
    {
        var ticket = new Ticket {
            Title = dto.Title, Description = dto.Description,
            Priority = dto.Priority ?? "Medium", LoanId = dto.LoanId,
            CreatedByUserId = CurrentUserId, CreatedAt = DateTime.UtcNow
        };
        _db.Tickets.Add(ticket);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { ticket.Id }, "Ticket created."));
    }

    [HttpPatch("{id:int}/close")]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> Close(int id)
    {
        var ticket = await _db.Tickets.FindAsync(id);
        if (ticket == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        ticket.Status = "Closed"; ticket.ClosedAt = DateTime.UtcNow; ticket.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Ticket closed."));
    }

    [HttpPatch("{id:int}/reopen")]
    public async Task<IActionResult> Reopen(int id)
    {
        var ticket = await _db.Tickets.FindAsync(id);
        if (ticket == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        ticket.Status = "Open"; ticket.ClosedAt = null; ticket.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Ticket reopened."));
    }
}

public class TicketCreateDto {
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? Priority { get; set; }
    public int? LoanId { get; set; }
}
