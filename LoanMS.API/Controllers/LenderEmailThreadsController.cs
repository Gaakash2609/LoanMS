using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── Lender Email Workflow — thread log — full database persistence ──────────
// Was frontend-only (lender-email-workflow.js, localStorage key
// 'efin_lew_email_threads_v1'). Append-only audit trail, mirrors
// AssignmentAuditController: any authenticated user can read/append, no
// update/delete (a conversation log is never edited after the fact).
[Authorize]
public class LenderEmailThreadsController : BaseController
{
    private readonly AppDbContext _db;
    public LenderEmailThreadsController(AppDbContext db) => _db = db;

    /// <summary>Full thread for one application, oldest first (matches the frontend's timeline order).</summary>
    [HttpGet("{loanApplicationId:int}")]
    public async Task<IActionResult> GetThread(int loanApplicationId)
    {
        var entries = await _db.LenderEmailThreadEntries
            .Where(t => t.LoanApplicationId == loanApplicationId)
            .OrderBy(t => t.CreatedAt)
            .Select(t => new
            {
                t.Id, t.Direction, t.Stage, t.RmName, t.RmEmail, t.Subject, t.BodyText,
                t.Source, t.ParsedDataJson, t.CreatedAt
            })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(entries));
    }

    /// <summary>Append one entry (sent or received) to an application's thread.</summary>
    [HttpPost]
    public async Task<IActionResult> AddEntry([FromBody] LenderEmailThreadEntryDto dto)
    {
        if (dto.LoanApplicationId <= 0)
            return BadRequest(ApiResponseDto<object>.Fail("loanApplicationId is required."));
        if (string.IsNullOrWhiteSpace(dto.Direction))
            return BadRequest(ApiResponseDto<object>.Fail("direction is required."));

        var loanExists = await _db.Loans.AnyAsync(l => l.Id == dto.LoanApplicationId);
        if (!loanExists)
            return BadRequest(ApiResponseDto<object>.Fail("Loan application not found."));

        var entry = new LenderEmailThreadEntry
        {
            LoanApplicationId = dto.LoanApplicationId,
            Direction = dto.Direction.Trim(),
            Stage = dto.Stage,
            RmName = dto.RmName,
            RmEmail = dto.RmEmail,
            Subject = dto.Subject,
            BodyText = dto.BodyText,
            Source = dto.Source,
            ParsedDataJson = dto.ParsedDataJson,
            CreatedAt = DateTime.UtcNow
        };
        _db.LenderEmailThreadEntries.Add(entry);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { entry.Id }, "Entry logged."));
    }
}

public class LenderEmailThreadEntryDto
{
    public int LoanApplicationId { get; set; }
    public string Direction { get; set; } = string.Empty;
    public string? Stage { get; set; }
    public string? RmName { get; set; }
    public string? RmEmail { get; set; }
    public string? Subject { get; set; }
    public string? BodyText { get; set; }
    public string? Source { get; set; }
    public string? ParsedDataJson { get; set; }
}
