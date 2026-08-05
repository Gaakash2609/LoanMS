using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.API.Controllers;

// ── Email Templates (Settings → Templates) — full database persistence ──────
// Was frontend-only (localStorage key 'efin_email_templates_v1'). Read open
// to any authenticated user (server-triggered auto-sends and any user
// previewing a template need this); mutations Admin-only, mirrors
// RejectionReasonsController/BanksController.
[Authorize]
public class EmailTemplatesController : BaseController
{
    private readonly AppDbContext _db;
    public EmailTemplatesController(AppDbContext db) => _db = db;

    /// <summary>All saved overrides, keyed by TemplateKey. Keys not present here mean "use the frontend default".</summary>
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var templates = await _db.EmailTemplates
            .Select(t => new { t.TemplateKey, t.Subject, t.Body, t.UpdatedAt })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(templates));
    }

    /// <summary>Create or update the override for one template key (upsert).</summary>
    [HttpPut("{templateKey}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Upsert(string templateKey, [FromBody] EmailTemplateDto dto)
    {
        if (string.IsNullOrWhiteSpace(templateKey))
            return BadRequest(ApiResponseDto<object>.Fail("Template key is required."));
        if (string.IsNullOrWhiteSpace(dto.Subject) || string.IsNullOrWhiteSpace(dto.Body))
            return BadRequest(ApiResponseDto<object>.Fail("Subject and body are required."));

        var key = templateKey.Trim().ToLower();
        var existing = await _db.EmailTemplates.FirstOrDefaultAsync(t => t.TemplateKey == key);
        if (existing == null)
        {
            existing = new EmailTemplate { TemplateKey = key, CreatedAt = DateTime.UtcNow };
            _db.EmailTemplates.Add(existing);
        }
        existing.Subject = dto.Subject;
        existing.Body = dto.Body;
        existing.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Template saved."));
    }

    /// <summary>Reset one template key back to the frontend default (removes the override).</summary>
    [HttpDelete("{templateKey}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Reset(string templateKey)
    {
        var key = (templateKey ?? string.Empty).Trim().ToLower();
        var existing = await _db.EmailTemplates.FirstOrDefaultAsync(t => t.TemplateKey == key);
        if (existing == null) return Ok(ApiResponseDto<bool>.Ok(true, "Already using default."));
        existing.IsDeleted = true;
        existing.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Reset to default."));
    }
}

public class EmailTemplateDto
{
    public string Subject { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
}
