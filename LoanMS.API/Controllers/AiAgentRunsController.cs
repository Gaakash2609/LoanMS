using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── AI Agent (Akshiv) — run history — full database persistence ─────────────
// Was frontend-only (ai-agent.js, localStorage key 'efin_ai_agent_v3').
// Append-mostly audit trail (a run's Status/FinishedAt/Error update once as
// it completes, steps are never edited after being appended): any
// authenticated user can read/create/update, matching how the agent itself
// runs client-side today under whichever user triggered it.
// The agent's on/off config (previously localStorage key
// 'efin_ai_agent_cfg_v3') is intentionally NOT duplicated here — it now
// reuses the existing generic /api/settings (AppSetting) endpoint, the same
// Admin-only, DB-backed mechanism already used for AI keys and branding.
[Authorize]
public class AiAgentRunsController : BaseController
{
    private readonly AppDbContext _db;
    public AiAgentRunsController(AppDbContext db) => _db = db;

    /// <summary>Recent runs for one application, newest first.</summary>
    [HttpGet("{loanApplicationId:int}")]
    public async Task<IActionResult> GetRuns(int loanApplicationId)
    {
        var runs = await _db.AiAgentRuns
            .Where(r => r.LoanApplicationId == loanApplicationId)
            .OrderByDescending(r => r.StartedAt)
            .Take(20)
            .Select(r => new
            {
                r.Id, r.RunId, r.StartedAt, r.FinishedAt, r.Status, r.Error, r.StepsJson
            })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(runs));
    }

    /// <summary>Start a new run.</summary>
    [HttpPost]
    public async Task<IActionResult> StartRun([FromBody] AiAgentRunStartDto dto)
    {
        if (dto.LoanApplicationId <= 0)
            return BadRequest(ApiResponseDto<object>.Fail("loanApplicationId is required."));

        var loanExists = await _db.Loans.AnyAsync(l => l.Id == dto.LoanApplicationId);
        if (!loanExists)
            return BadRequest(ApiResponseDto<object>.Fail("Loan application not found."));

        var run = new AiAgentRun
        {
            LoanApplicationId = dto.LoanApplicationId,
            RunId = string.IsNullOrWhiteSpace(dto.RunId) ? ("RUN-" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()) : dto.RunId,
            StartedAt = DateTime.UtcNow,
            Status = "running",
            CreatedAt = DateTime.UtcNow
        };
        _db.AiAgentRuns.Add(run);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { run.Id }, "Run started."));
    }

    /// <summary>Update a run as it progresses/finishes (steps/status/error).</summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> UpdateRun(int id, [FromBody] AiAgentRunUpdateDto dto)
    {
        var run = await _db.AiAgentRuns.FindAsync(id);
        if (run == null) return NotFound(ApiResponseDto<bool>.Fail("Run not found."));

        if (dto.StepsJson != null) run.StepsJson = dto.StepsJson;
        if (!string.IsNullOrWhiteSpace(dto.Status)) run.Status = dto.Status;
        if (dto.Error != null) run.Error = dto.Error;
        if (dto.Status is "success" or "failed") run.FinishedAt = DateTime.UtcNow;
        run.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Run updated."));
    }
}

public class AiAgentRunStartDto
{
    public int LoanApplicationId { get; set; }
    public string? RunId { get; set; }
}

public class AiAgentRunUpdateDto
{
    public string? StepsJson { get; set; }
    public string? Status { get; set; }
    public string? Error { get; set; }
}
