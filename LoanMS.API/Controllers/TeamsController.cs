using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

[Authorize(Roles = "Admin,Manager")]
public class TeamsController : BaseController
{
    private readonly AppDbContext _db;
    public TeamsController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? type)
    {
        var q = _db.Teams.Include(t => t.TeamLead).Include(t => t.Members).ThenInclude(m => m.User).AsQueryable();
        if (!string.IsNullOrEmpty(type)) q = q.Where(t => t.Type == type);

        var teams = await q.Select(t => new {
            t.Id, t.Name, t.Type, t.LocationId,
            TeamLead = t.TeamLead != null ? t.TeamLead.FullName : null,
            Members  = t.Members.Select(m => new { m.UserId, m.User.FullName, m.User.Email }).ToList()
        }).ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(teams));
    }

    [HttpPost]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Create([FromBody] TeamCreateDto dto)
    {
        var team = new Team {
            Name = dto.Name, Type = dto.Type ?? "Sales",
            LocationId = dto.LocationId, TeamLeadUserId = dto.TeamLeadUserId,
            CreatedAt = DateTime.UtcNow
        };
        _db.Teams.Add(team);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { team.Id }, "Team created."));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Update(int id, [FromBody] TeamCreateDto dto)
    {
        var team = await _db.Teams.FindAsync(id);
        if (team == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        team.Name = dto.Name; team.Type = dto.Type ?? team.Type;
        team.LocationId = dto.LocationId; team.TeamLeadUserId = dto.TeamLeadUserId;
        team.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Updated."));
    }

    [HttpPost("{id:int}/members")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> AddMember(int id, [FromBody] TeamMemberDto dto)
    {
        var exists = await _db.TeamMembers.AnyAsync(m => m.TeamId == id && m.UserId == dto.UserId);
        if (exists) return BadRequest(ApiResponseDto<bool>.Fail("User already in team."));
        _db.TeamMembers.Add(new TeamMember { TeamId = id, UserId = dto.UserId, CreatedAt = DateTime.UtcNow });
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Member added."));
    }

    [HttpDelete("{id:int}/members/{userId:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> RemoveMember(int id, int userId)
    {
        var member = await _db.TeamMembers.FirstOrDefaultAsync(m => m.TeamId == id && m.UserId == userId);
        if (member == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        member.IsDeleted = true; member.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Member removed."));
    }
}

public class TeamCreateDto {
    public string Name { get; set; } = string.Empty;
    public string? Type { get; set; }
    public int? LocationId { get; set; }
    public int? TeamLeadUserId { get; set; }
}
public class TeamMemberDto { public int UserId { get; set; } }
