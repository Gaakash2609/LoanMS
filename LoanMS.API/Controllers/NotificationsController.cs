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
}

public class WebhookPayloadDto
{
    public string Type { get; set; } = string.Empty;
    public object? Data { get; set; }
}
