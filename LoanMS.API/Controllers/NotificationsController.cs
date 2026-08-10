using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text;
using System.Text.Json;

namespace LoanMS.API.Controllers;

/// <summary>
/// Notification & Webhook controller.
/// Supports: in-app notifications, webhook relay (Slack/Teams/custom), email alerts.
/// </summary>
[Authorize]
public class NotificationsController : BaseController
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _cfg;
    private readonly IHttpClientFactory _http;

    public NotificationsController(AppDbContext db, IConfiguration cfg, IHttpClientFactory http)
    {
        _db   = db;
        _cfg  = cfg;
        _http = http;
    }

    /// <summary>Send webhook notification to configured URL</summary>
    [HttpPost("webhook")]
    public async Task<IActionResult> SendWebhook([FromBody] WebhookPayloadDto dto)
    {
        var webhookUrl = await _db.AppSettings
            .Where(s => s.Key == "webhook_url" && !s.IsDeleted)
            .Select(s => s.Value)
            .FirstOrDefaultAsync();

        if (string.IsNullOrEmpty(webhookUrl))
            return Ok(ApiResponseDto<object>.Ok(new { sent = false, reason = "No webhook URL configured." }));

        try
        {
            var client  = _http.CreateClient();
            var payload = JsonSerializer.Serialize(new {
                type      = dto.Type,
                data      = dto.Data,
                timestamp = DateTime.UtcNow,
                system    = "EFIN Loan Management"
            });
            var content  = new StringContent(payload, Encoding.UTF8, "application/json");
            var response = await client.PostAsync(webhookUrl, content);
            return Ok(ApiResponseDto<object>.Ok(new { sent = response.IsSuccessStatusCode, statusCode = (int)response.StatusCode }));
        }
        catch (Exception ex)
        {
            // Log internally — never expose internal URLs or exception details to caller
            var logger = HttpContext.RequestServices.GetRequiredService<ILogger<NotificationsController>>();
            logger.LogWarning(ex, "Webhook delivery failed for type {Type}", dto.Type);
            return Ok(ApiResponseDto<object>.Ok(new { sent = false, reason = "Webhook delivery failed. Check webhook URL configuration." }));
        }
    }

    /// <summary>Get notification settings</summary>
    [HttpGet("settings")]
    public async Task<IActionResult> GetSettings()
    {
        var settings = await _db.AppSettings
            .Where(s => (s.Key.StartsWith("webhook") || s.Key.StartsWith("notif") || s.Key.StartsWith("email")) && !s.IsDeleted)
            .ToDictionaryAsync(s => s.Key, s => s.Value);
        return Ok(ApiResponseDto<object>.Ok(settings));
    }

    /// <summary>Save notification settings</summary>
    [HttpPost("settings")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> SaveSettings([FromBody] Dictionary<string, string> settings)
    {
        foreach (var kv in settings)
        {
            var existing = await _db.AppSettings.FirstOrDefaultAsync(s => s.Key == kv.Key && !s.IsDeleted);
            if (existing != null)
            { existing.Value = kv.Value; existing.UpdatedAt = DateTime.UtcNow; }
            else
            { _db.AppSettings.Add(new AppSetting { Key = kv.Key, Value = kv.Value, Category = "notifications", CreatedAt = DateTime.UtcNow }); }
        }
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Notification settings saved."));
    }

    /// <summary>Test webhook — sends a test payload to configured URL</summary>
    [HttpPost("test-webhook")]
    [Authorize(Roles = "Admin,Manager")]
    public async Task<IActionResult> TestWebhook()
    {
        return await SendWebhook(new WebhookPayloadDto
        {
            Type = "test",
            Data = new { message = "EFIN webhook test — connection successful!", timestamp = DateTime.UtcNow }
        });
    }

    // ── In-app notifications (Management alerts) ────────────────────────────
    // Was frontend-only (notifyManagement() in efin-app.js, localStorage key
    // 'mgmt_notifications') — written to whichever browser triggered the
    // event, so the intended recipient (Admin/Accounts, often a different
    // device) never actually saw it. Now DB-backed and role-targeted: any
    // user whose role matches TargetRole (or a null/global TargetRole) can
    // read/mark-read; creating one is unrestricted since it's triggered
    // internally by app events (e.g. a DSA/partner submitting a payout claim),
    // not a user-facing form.

    /// <summary>List recent notifications for the current user's role (or role-agnostic ones).</summary>
    [HttpGet]
    public async Task<IActionResult> GetNotifications([FromQuery] bool unreadOnly = false)
    {
        var role = CurrentUserRole;
        var userId = CurrentUserId;
        // Visibility: a pure broadcast (TargetRole AND TargetUserId both
        // null) is visible to everyone; otherwise a role match OR a
        // specific-user match makes it visible — NOT "TargetRole == null"
        // alone, which would incorrectly broadcast a user-targeted (e.g.
        // SLA-breach) notification to every role just because its
        // TargetRole happens to be unset.
        var query = _db.AppNotifications.Where(n =>
            (n.TargetRole == null && n.TargetUserId == null) ||
            n.TargetRole == role ||
            n.TargetUserId == userId);
        if (unreadOnly) query = query.Where(n => !n.IsRead);

        var items = await query
            .OrderByDescending(n => n.CreatedAt)
            .Take(50)
            .Select(n => new { n.Id, n.Type, n.Icon, n.Message, n.ClaimId, n.Partner, n.Amount, n.TargetUserId, n.IsRead, n.CreatedAt })
            .ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(items));
    }

    /// <summary>Create a notification (called internally by app events, e.g. payout claim submission,
    /// application created/approved/rejected/disbursed/stage-changed).</summary>
    [HttpPost]
    public async Task<IActionResult> CreateNotification([FromBody] AppNotificationDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.Type))
            return BadRequest(ApiResponseDto<object>.Fail("Type is required."));

        var notification = new AppNotification
        {
            Type = dto.Type.Trim(),
            Icon = dto.Icon?.Trim(),
            Message = dto.Message?.Trim(),
            ClaimId = dto.ClaimId,
            Partner = dto.Partner?.Trim(),
            Amount = dto.Amount,
            TargetRole = dto.TargetRole?.Trim(),
            TargetUserId = dto.TargetUserId,
            CreatedAt = DateTime.UtcNow
        };
        _db.AppNotifications.Add(notification);
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<object>.Ok(new { notification.Id }, "Notification created."));
    }

    /// <summary>Mark a notification as read.</summary>
    [HttpPut("{id:int}/read")]
    public async Task<IActionResult> MarkRead(int id)
    {
        var n = await _db.AppNotifications.FindAsync(id);
        if (n == null) return NotFound(ApiResponseDto<bool>.Fail("Notification not found."));
        // Ownership check (productivity/reliability audit item #7) — same
        // visibility rule already used by GetNotifications: a pure
        // broadcast (both null) is fair game for anyone, a role-targeted
        // one requires a role match, a user-targeted one requires being
        // that exact user. Prevents one user's client from being able to
        // silently flip another user's/role's notification to read by
        // guessing an id — low real-world impact (no data exposed either
        // way) but closes the gap cleanly since the same rule already
        // exists elsewhere in this file.
        var isVisibleToCaller =
            (n.TargetRole == null && n.TargetUserId == null) ||
            n.TargetRole == CurrentUserRole ||
            n.TargetUserId == CurrentUserId;
        if (!isVisibleToCaller)
            return NotFound(ApiResponseDto<bool>.Fail("Notification not found."));
        n.IsRead = true;
        n.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Marked as read."));
    }
}

public class AppNotificationDto
{
    public string Type { get; set; } = string.Empty;
    public string? Icon { get; set; }
    public string? Message { get; set; }
    public string? ClaimId { get; set; }
    public string? Partner { get; set; }
    public decimal? Amount { get; set; }
    public string? TargetRole { get; set; }
    public int? TargetUserId { get; set; }
}

public class WebhookPayloadDto
{
    public string Type { get; set; } = string.Empty;
    public object? Data { get; set; }
}
