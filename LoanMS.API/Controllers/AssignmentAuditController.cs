using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Newtonsoft.Json;

namespace LoanMS.API.Controllers;

// ── Assignment Audit Log — Loan Application auto-assignment trail ───────────
// Backs ASSIGNMENT_AUDIT_LOG on the frontend (efin-app.js). Previously this
// was a frontend-only in-memory array persisted only to the browser's
// localStorage, so history recorded on one device/browser never appeared on
// another. Insert-only by design (mirrors AssignmentLog/ReportTargets'
// simple-master-data convention) — this is a write-once audit trail, so
// there is deliberately no PUT/DELETE here: a client can read history but
// can never edit or erase it. GET is open to any authenticated user (same
// as most read-only master data in this codebase, e.g. DsaController.GetAll);
// POST requires only [Authorize] since every role that can create/reassign a
// loan application (which is what triggers a push on the frontend) already
// needs to be able to write its own audit entry.
[Authorize]
[Route("api/assignment-audit")]
public class AssignmentAuditController : BaseController
{
    private readonly AppDbContext _db;
    public AssignmentAuditController(AppDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? loanId, [FromQuery] int take = 200)
    {
        var q = _db.AssignmentAuditLogs.AsQueryable();

        // "loanId" may be either the numeric backend Loan id or the frontend
        // application id (e.g. "EFIN000123") — accept either so the frontend
        // never has to know which one it currently has on hand.
        if (!string.IsNullOrWhiteSpace(loanId))
        {
            if (int.TryParse(loanId, out var numericId))
                q = q.Where(a => a.LoanApplicationId == numericId || a.LoanFrontendId == loanId);
            else
                q = q.Where(a => a.LoanFrontendId == loanId);
        }

        var capped = Math.Clamp(take, 1, 1000);
        var logs = await q.OrderByDescending(a => a.AssignedAt)
            .Take(capped)
            .Select(a => new AssignmentAuditLogDto
            {
                Id = a.Id,
                LoanApplicationId = a.LoanApplicationId,
                LoanFrontendId = a.LoanFrontendId,
                Location = a.Location,
                LoanType = a.LoanType,
                SalesPerson = a.SalesPerson,
                SalesTeam = a.SalesTeam,
                AssignedToUserId = a.AssignedToUserId,
                AssignedToUserName = a.AssignedToUserName,
                AssignedByUserId = a.AssignedByUserId,
                AssignedByName = a.AssignedByName,
                Method = a.Method,
                TieBreak = a.TieBreak,
                PreviousUserName = a.PreviousUserName,
                Reason = a.Reason,
                CandidatesJson = a.CandidatesJson,
                AssignedAt = a.AssignedAt,
                CreatedAt = a.CreatedAt
            })
            .ToListAsync();

        return Ok(ApiResponseDto<object>.Ok(logs));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateAssignmentAuditLogRequestDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.LoanFrontendId))
            return BadRequest(ApiResponseDto<object>.Fail("LoanFrontendId is required."));
        if (string.IsNullOrWhiteSpace(dto.Method))
            return BadRequest(ApiResponseDto<object>.Fail("Method is required."));

        var entry = new AssignmentAuditLog
        {
            LoanApplicationId = dto.LoanApplicationId,
            LoanFrontendId = dto.LoanFrontendId.Trim(),
            Location = dto.Location,
            LoanType = dto.LoanType,
            SalesPerson = dto.SalesPerson,
            SalesTeam = dto.SalesTeam,
            AssignedToUserId = dto.AssignedToUserId,
            AssignedToUserName = dto.AssignedToUserName,
            // AssignedByUserId is only meaningful for a MANUAL decision — a real
            // logged-in user made it, and CurrentUserId (from the authenticated
            // JWT) is the trustworthy source, never client-supplied input.
            // AUTOMATIC decisions have no acting user, so this stays null.
            AssignedByUserId = dto.Method == "manual" ? CurrentUserId : null,
            AssignedByName = string.IsNullOrWhiteSpace(dto.AssignedByName) ? "System (Auto)" : dto.AssignedByName,
            Method = dto.Method,
            TieBreak = dto.TieBreak,
            PreviousUserName = dto.PreviousUserName,
            Reason = dto.Reason,
            CandidatesJson = dto.Candidates != null ? JsonConvert.SerializeObject(dto.Candidates) : null,
            AssignedAt = dto.AssignedAt == default ? DateTime.UtcNow : dto.AssignedAt,
            CreatedAt = DateTime.UtcNow
        };

        _db.AssignmentAuditLogs.Add(entry);
        await _db.SaveChangesAsync();

        return Ok(ApiResponseDto<object>.Ok(new { entry.Id }, "Assignment audit entry recorded."));
    }
}
