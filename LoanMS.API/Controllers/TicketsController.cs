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
    private readonly LoanMS.API.Services.IRolePermissionService _rolePerm;
    public TicketsController(AppDbContext db, LoanMS.API.Services.IRolePermissionService rolePerm) { _db = db; _rolePerm = rolePerm; }

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? status)
    {
        if (!await _rolePerm.IsMenuAllowedAsync(CurrentUserRole, "tickets"))
            return Forbid();

        var q = _db.Tickets.Include(t => t.CreatedBy).Include(t => t.AssignedTo).AsQueryable();
        if (!string.IsNullOrEmpty(status)) q = q.Where(t => t.Status == status);

        // Scope: Sales, Dsa, and Partner see only their own tickets.
        // Phase 3B fix: was comparing against "partner"/"dsa_user", which never
        // matched the actual role claim ("Dsa"/"Partner"), so those two roles
        // could see every ticket instead of just their own.
        if (CurrentUserRole == "Sales" ||
            CurrentUserRole == "Dsa" ||
            CurrentUserRole == "Partner")
            q = q.Where(t => t.CreatedByUserId == CurrentUserId);

        var tickets = await q.OrderByDescending(t => t.CreatedAt)
            .Select(t => new {
                t.Id, t.Title, t.Description, t.Status, t.Priority,
                t.LoanId, CreatedBy = t.CreatedBy.FullName,
                AssignedTo = t.AssignedTo != null ? t.AssignedTo.FullName : null,
                AssignedToUserId = t.AssignedToUserId,
                t.CreatedAt, t.UpdatedAt, t.ClosedAt
            }).ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(tickets));
    }

    // Phase 4A: single-ticket read, needed by Update's ownership check and any
    // future ticket-detail UI. Same role-scoping as GetAll so a Sales/Dsa/Partner
    // user can't fetch a ticket that isn't theirs by guessing an id.
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var ticket = await _db.Tickets.Include(t => t.CreatedBy).Include(t => t.AssignedTo)
            .FirstOrDefaultAsync(t => t.Id == id);
        if (ticket == null) return NotFound(ApiResponseDto<object>.Fail("Not found."));

        if ((CurrentUserRole == "Sales" || CurrentUserRole == "Dsa" || CurrentUserRole == "Partner")
            && ticket.CreatedByUserId != CurrentUserId)
            return NotFound(ApiResponseDto<object>.Fail("Not found."));

        return Ok(ApiResponseDto<object>.Ok(new {
            ticket.Id, ticket.Title, ticket.Description, ticket.Status, ticket.Priority,
            ticket.LoanId, CreatedBy = ticket.CreatedBy.FullName, CreatedByUserId = ticket.CreatedByUserId,
            AssignedTo = ticket.AssignedTo != null ? ticket.AssignedTo.FullName : null,
            AssignedToUserId = ticket.AssignedToUserId,
            ticket.CreatedAt, ticket.UpdatedAt, ticket.ClosedAt
        }));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] TicketCreateDto dto)
    {
        var ticket = new Ticket {
            Title = dto.Title, Description = dto.Description,
            Priority = dto.Priority ?? "Medium", LoanId = dto.LoanId,
            AssignedToUserId = dto.AssignedToUserId,
            CreatedByUserId = CurrentUserId, CreatedAt = DateTime.UtcNow
        };
        _db.Tickets.Add(ticket);
        await _db.SaveChangesAsync(); // assigns ticket.Id, needed for the log entry below

        // Phase 5C: record the initial assignment, if the ticket was created
        // pre-assigned. FromUserId is null (new ticket, not a reassignment).
        if (dto.AssignedToUserId.HasValue)
        {
            var assignee = await _db.Users.FindAsync(dto.AssignedToUserId.Value);
            AssignmentLogHelper.Log(_db, "Ticket", ticket.Id, null, null,
                dto.AssignedToUserId.Value, assignee?.FullName ?? "Unknown",
                CurrentUserId, CurrentUserEmail);
            await _db.SaveChangesAsync();
        }

        return Ok(ApiResponseDto<object>.Ok(new { ticket.Id }, "Ticket created."));
    }

    // Phase 4A: general field edit (title/description/priority/assignment).
    // Deliberately separate from Close/Reopen, whose real wiring is Phase 4B.
    // No frontend "edit ticket" UI calls this yet — added so the CRUD surface
    // is complete and ready once that UI exists.
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] TicketUpdateDto dto)
    {
        var ticket = await _db.Tickets.FindAsync(id);
        if (ticket == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));

        // Only the creator, the currently assigned user, or Admin/Manager may edit.
        var isOwnerOrAssignee = ticket.CreatedByUserId == CurrentUserId || ticket.AssignedToUserId == CurrentUserId;
        var isPrivileged = CurrentUserRole == "Admin" || CurrentUserRole == "Manager";
        if (!isOwnerOrAssignee && !isPrivileged)
            return Forbid();

        if (dto.AssignedToUserId.HasValue && dto.AssignedToUserId != ticket.AssignedToUserId)
        {
            var prevAssignee = ticket.AssignedToUserId.HasValue
                ? await _db.Users.FindAsync(ticket.AssignedToUserId.Value) : null;
            var newAssignee = await _db.Users.FindAsync(dto.AssignedToUserId.Value);
            _db.TicketComments.Add(new TicketComment {
                TicketId = ticket.Id, UserId = CurrentUserId, Type = "Activity",
                Content = $"Reassigned from {(prevAssignee?.FullName ?? "Unassigned")} to {(newAssignee?.FullName ?? "Unknown")}.",
                CreatedAt = DateTime.UtcNow
            });
            // Phase 5C: structured assignment-log entry alongside the existing
            // human-readable Activity comment above — same event, two views.
            // Actor is always CurrentUserId (JWT), never client-supplied.
            AssignmentLogHelper.Log(_db, "Ticket", ticket.Id,
                ticket.AssignedToUserId, prevAssignee?.FullName,
                dto.AssignedToUserId.Value, newAssignee?.FullName ?? "Unknown",
                CurrentUserId, CurrentUserEmail);
            ticket.AssignedToUserId = dto.AssignedToUserId;
        }

        if (dto.Title != null) ticket.Title = dto.Title;
        if (dto.Description != null) ticket.Description = dto.Description;
        if (dto.Priority != null) ticket.Priority = dto.Priority;

        // Phase 4B: the frontend's "Resolve" action has no dedicated endpoint —
        // trace of actual usage shows it's a status-only change, same shape as
        // Title/Description/Priority above. Route it through here rather than
        // inventing a new endpoint. "Closed" is deliberately excluded: that
        // transition must go through Close so its Admin/Manager-only rule and
        // ClosedAt bookkeeping can't be bypassed via a plain field edit.
        if (dto.Status != null && !string.Equals(dto.Status, ticket.Status, StringComparison.OrdinalIgnoreCase))
        {
            if (string.Equals(dto.Status, "Closed", StringComparison.OrdinalIgnoreCase))
                return BadRequest(ApiResponseDto<bool>.Fail("Use the Close action to close a ticket."));
            if (string.Equals(ticket.Status, "Closed", StringComparison.OrdinalIgnoreCase))
                return BadRequest(ApiResponseDto<bool>.Fail("Use the Reopen action on a closed ticket."));

            var allowed = new[] { "Open", "In Progress", "Resolved" };
            var match = Array.Find(allowed, s => string.Equals(s, dto.Status, StringComparison.OrdinalIgnoreCase));
            if (match == null)
                return BadRequest(ApiResponseDto<bool>.Fail("Invalid status."));

            _db.TicketComments.Add(new TicketComment {
                TicketId = ticket.Id, UserId = CurrentUserId, Type = "Activity",
                Content = $"Status changed from {ticket.Status} to {match}.", CreatedAt = DateTime.UtcNow
            });
            ticket.Status = match;
        }

        ticket.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Ticket updated."));
    }

    // Phase 4B: Close/Reopen are the only two status transitions this endpoint
    // set supports. Kept as separate PATCH actions (rather than folded into the
    // general Update endpoint) so each can carry its own authorization rule and
    // so a status change always produces an Activity record.
    [HttpPatch("{id:int}/close")]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> Close(int id)
    {
        var ticket = await _db.Tickets.FindAsync(id);
        if (ticket == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        if (ticket.Status == "Closed") return Ok(ApiResponseDto<bool>.Ok(true, "Ticket already closed."));

        ticket.Status = "Closed"; ticket.ClosedAt = DateTime.UtcNow; ticket.UpdatedAt = DateTime.UtcNow;
        _db.TicketComments.Add(new TicketComment {
            TicketId = ticket.Id, UserId = CurrentUserId, Type = "Activity",
            Content = "Ticket closed.", CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Ticket closed."));
    }

    // Phase 4B: previously any authenticated user could reopen any ticket
    // (no role/ownership check at all). Restrict to the same set of people who
    // are allowed to edit the ticket (creator, current assignee, Admin/Manager)
    // so Close and Reopen carry a consistent authorization story.
    [HttpPatch("{id:int}/reopen")]
    public async Task<IActionResult> Reopen(int id)
    {
        var ticket = await _db.Tickets.FindAsync(id);
        if (ticket == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));

        var isOwnerOrAssignee = ticket.CreatedByUserId == CurrentUserId || ticket.AssignedToUserId == CurrentUserId;
        var isPrivileged = CurrentUserRole == "Admin" || CurrentUserRole == "Manager";
        if (!isOwnerOrAssignee && !isPrivileged)
            return Forbid();

        if (ticket.Status == "Open") return Ok(ApiResponseDto<bool>.Ok(true, "Ticket already open."));

        ticket.Status = "Open"; ticket.ClosedAt = null; ticket.UpdatedAt = DateTime.UtcNow;
        _db.TicketComments.Add(new TicketComment {
            TicketId = ticket.Id, UserId = CurrentUserId, Type = "Activity",
            Content = "Ticket reopened.", CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Ticket reopened."));
    }

    // Phase 4B: comments/notes/activity panel.
    [HttpGet("{id:int}/comments")]
    public async Task<IActionResult> GetComments(int id)
    {
        var ticket = await _db.Tickets.FindAsync(id);
        if (ticket == null) return NotFound(ApiResponseDto<object>.Fail("Not found."));

        if ((CurrentUserRole == "Sales" || CurrentUserRole == "Dsa" || CurrentUserRole == "Partner")
            && ticket.CreatedByUserId != CurrentUserId)
            return NotFound(ApiResponseDto<object>.Fail("Not found."));

        var comments = await _db.TicketComments.Include(c => c.User)
            .Where(c => c.TicketId == id)
            .OrderBy(c => c.CreatedAt)
            .Select(c => new { c.Id, c.Content, c.Type, User = c.User.FullName, c.CreatedAt })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(comments));
    }

    [HttpPost("{id:int}/comments")]
    public async Task<IActionResult> AddComment(int id, [FromBody] TicketCommentCreateDto dto)
    {
        var ticket = await _db.Tickets.FindAsync(id);
        if (ticket == null) return NotFound(ApiResponseDto<object>.Fail("Not found."));

        if ((CurrentUserRole == "Sales" || CurrentUserRole == "Dsa" || CurrentUserRole == "Partner")
            && ticket.CreatedByUserId != CurrentUserId)
            return NotFound(ApiResponseDto<object>.Fail("Not found."));

        if (string.IsNullOrWhiteSpace(dto.Content))
            return BadRequest(ApiResponseDto<object>.Fail("Comment cannot be empty."));

        // Type is always "Comment" for user-submitted notes — "Activity" is
        // reserved for system-generated rows written by Close/Reopen/Update.
        var comment = new TicketComment {
            TicketId = id, UserId = CurrentUserId, Type = "Comment",
            Content = dto.Content.Trim(), CreatedAt = DateTime.UtcNow
        };
        _db.TicketComments.Add(comment);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { comment.Id }, "Comment added."));
    }
}

public class TicketCreateDto {
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? Priority { get; set; }
    public int? LoanId { get; set; }
    public int? AssignedToUserId { get; set; }
}

public class TicketUpdateDto {
    public string? Title { get; set; }
    public string? Description { get; set; }
    public string? Priority { get; set; }
    public string? Status { get; set; }
    public int? AssignedToUserId { get; set; }
}

public class TicketCommentCreateDto {
    public string Content { get; set; } = string.Empty;
}
