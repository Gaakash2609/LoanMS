using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace LoanMS.API.Controllers;

/// <summary>
/// Single, unified entry point for every transactional email the app sends
/// (invitation, admin-triggered password reset, loan approval / rejection /
/// disbursement, EMI reminders, document requests, stage-change notices, and
/// any generic notification). The frontend builds the subject/HTML (templates
/// already live in efin-app.js) and posts it here; the server resolves the
/// saved provider config (Settings → Mail & Email) and actually delivers it —
/// no SMTP/Brevo credentials are ever present in the browser.
/// </summary>
[Authorize]
public class EmailController : BaseController
{
    private readonly IEmailService _email;

    public EmailController(IEmailService email) => _email = email;

    [HttpPost("send")]
    public async Task<IActionResult> Send([FromBody] EmailSendDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.To))
            return BadRequest(ApiResponseDto<bool>.Fail("Recipient email ('to') is required."));
        if (string.IsNullOrWhiteSpace(dto.Subject))
            return BadRequest(ApiResponseDto<bool>.Fail("Subject is required."));
        if (string.IsNullOrWhiteSpace(dto.Html))
            return BadRequest(ApiResponseDto<bool>.Fail("Email body ('html') is required."));

        try
        {
            await _email.SendAsync(dto.To.Trim(), dto.ToName ?? string.Empty, dto.Subject, dto.Html, dto.Cc, dto.ReplyTo);
            return Ok(ApiResponseDto<bool>.Ok(true, "Email sent."));
        }
        catch (InvalidOperationException ex)
        {
            // Config-not-set or provider-rejected — real, actionable message for the UI toast.
            return Ok(ApiResponseDto<bool>.Fail(ex.Message));
        }
        catch (Exception ex)
        {
            return Ok(ApiResponseDto<bool>.Fail("Email send failed: " + ex.Message));
        }
    }
}

public class EmailSendDto
{
    public string To       { get; set; } = string.Empty;
    public string? ToName  { get; set; }
    public string Subject  { get; set; } = string.Empty;
    public string Html     { get; set; } = string.Empty;
    public string? Cc      { get; set; }
    public string? ReplyTo { get; set; }
}
