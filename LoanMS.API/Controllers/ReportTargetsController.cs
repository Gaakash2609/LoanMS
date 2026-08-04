using System.Text.RegularExpressions;
using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── Report Targets — Reports & Analytics monthly KPI targets ────────────────
// Backs the "Target Editor" panel on the Reports & Analytics page. Previously
// this was RPT_TARGETS — a hardcoded in-memory object in efin-app.js with no
// backend at all, so any edit made by one user/device never appeared
// anywhere else and reset to the seed values on every refresh. This mirrors
// BanksController, the closest structural analog (simple flat master-data
// list, GET open to any authenticated user, mutations gated by role) — the
// one difference is that here Manager (not just Admin) can also create/edit,
// per the task's RBAC requirement, matching the existing
// "Admin,Manager" convention already used by BureauController/AIController.
[Authorize]
[Route("api/report-targets")]
public class ReportTargetsController : BaseController
{
    private static readonly Regex MonthPattern = new(@"^\d{4}-(0[1-9]|1[0-2])$", RegexOptions.Compiled);

    private readonly AppDbContext _db;
    public ReportTargetsController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var targets = await _db.ReportTargets
            .OrderBy(t => t.TargetMonth)
            .Select(t => new ReportTargetDto
            {
                Id = t.Id,
                TargetMonth = t.TargetMonth,
                UserId = t.UserId,
                TeamId = t.TeamId,
                DisbAmt = t.DisbAmt,
                LoginCount = t.LoginCount,
                DisbCount = t.DisbCount,
                CreatedAt = t.CreatedAt,
                UpdatedAt = t.UpdatedAt
            })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(targets));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var target = await _db.ReportTargets.FindAsync(id);
        if (target == null) return NotFound(ApiResponseDto<bool>.Fail("Report target not found."));
        return Ok(ApiResponseDto<ReportTarget>.Ok(target));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> Create([FromBody] CreateReportTargetRequestDto dto)
    {
        var month = dto.TargetMonth?.Trim() ?? string.Empty;
        if (!MonthPattern.IsMatch(month))
            return BadRequest(ApiResponseDto<object>.Fail("Target Month must be in YYYY-MM format."));

        // Server-side duplicate check for the org-wide (UserId/TeamId null) case
        // — the client-supplied data is never trusted for uniqueness; this is
        // enforced here and backed by the DB-level partial unique index as a
        // second guard, same convention as BanksController.
        if (dto.UserId == null && dto.TeamId == null)
        {
            var exists = await _db.ReportTargets.AnyAsync(t =>
                t.TargetMonth == month && t.UserId == null && t.TeamId == null);
            if (exists)
                return BadRequest(ApiResponseDto<object>.Fail("A target for this month already exists."));
        }

        var target = new ReportTarget
        {
            TargetMonth = month,
            UserId = dto.UserId,
            TeamId = dto.TeamId,
            DisbAmt = dto.DisbAmt,
            LoginCount = dto.LoginCount,
            DisbCount = dto.DisbCount,
            CreatedByUserId = CurrentUserId,
            CreatedAt = DateTime.UtcNow
        };

        try
        {
            _db.ReportTargets.Add(target);
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Race-condition fallback: two concurrent requests both passed the
            // AnyAsync check above but the unique index rejected the second insert.
            return BadRequest(ApiResponseDto<object>.Fail("A target for this month already exists."));
        }

        return Ok(ApiResponseDto<object>.Ok(new { target.Id }, "Report target created."));
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateReportTargetRequestDto dto)
    {
        var target = await _db.ReportTargets.FindAsync(id);
        if (target == null) return NotFound(ApiResponseDto<bool>.Fail("Report target not found."));

        target.DisbAmt = dto.DisbAmt;
        target.LoginCount = dto.LoginCount;
        target.DisbCount = dto.DisbCount;
        target.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Report target updated."));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> Delete(int id)
    {
        var target = await _db.ReportTargets.FindAsync(id);
        if (target == null) return NotFound(ApiResponseDto<bool>.Fail("Report target not found."));

        // Soft delete only — same convention as BanksController/DsaController.
        target.IsDeleted = true;
        target.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Report target deleted."));
    }
}
