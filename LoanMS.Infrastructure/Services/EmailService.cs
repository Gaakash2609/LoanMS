using LoanMS.Application.Interfaces;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MimeKit;

namespace LoanMS.Infrastructure.Services;

/// <summary>
/// Production-ready email service using MailKit + MimeKit.
/// Configure in appsettings under "Email": Host, Port, User, Password, FromAddress, FromName.
/// Set UseSsl=true for port 465, UseTls=true for port 587 (STARTTLS).
/// </summary>
public class EmailService : IEmailService
{
    private readonly IConfiguration       _cfg;
    private readonly ILogger<EmailService> _log;

    public EmailService(IConfiguration cfg, ILogger<EmailService> log)
    {
        _cfg = cfg;
        _log = log;
    }

    public async Task SendPasswordResetEmailAsync(string toEmail, string toName, string resetLink)
    {
        var subject  = "Reset Your LoanMS Password";
        var htmlBody = $"""
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
              <h2 style="color:#6366f1">Password Reset Request</h2>
              <p>Hi {toName},</p>
              <p>We received a request to reset your LoanMS password. Click the button below to set a new password:</p>
              <p style="text-align:center;margin:32px 0">
                <a href="{resetLink}"
                   style="background:#6366f1;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600">
                  Reset Password
                </a>
              </p>
              <p style="color:#6b7280;font-size:13px">
                This link expires in 1 hour. If you did not request a password reset, please ignore this email.
              </p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
              <p style="color:#9ca3af;font-size:12px">LoanMS &mdash; Loan Management System</p>
            </div>
            """;

        await SendAsync(toEmail, subject, htmlBody);
    }

    // ── Internal helper ───────────────────────────────────────────────────────

    private async Task SendAsync(string to, string subject, string htmlBody)
    {
        var host        = _cfg["Email:Host"]        ?? _cfg["Email:SmtpHost"] ?? "smtp.gmail.com";
        var portStr     = _cfg["Email:Port"]        ?? _cfg["Email:SmtpPort"] ?? "587";
        var user        = _cfg["Email:User"]        ?? _cfg["Email:SmtpUser"] ?? string.Empty;
        var password    = _cfg["Email:Password"]    ?? _cfg["Email:SmtpPassword"] ?? string.Empty;
        var fromAddress = _cfg["Email:FromAddress"] ?? user;
        var fromName    = _cfg["Email:FromName"]    ?? "LoanMS";
        var useSsl      = _cfg.GetValue<bool>("Email:UseSsl");
        var useTls      = _cfg.GetValue("Email:UseTls", true);

        if (string.IsNullOrEmpty(user) || string.IsNullOrEmpty(password))
        {
            _log.LogWarning("Email not configured — skipping send to {To}", to);
            return;
        }

        var port = int.TryParse(portStr, out var p) ? p : 587;

        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(fromName, fromAddress));
        message.To.Add(MailboxAddress.Parse(to));
        message.Subject = subject;
        message.Body    = new TextPart("html") { Text = htmlBody };

        try
        {
            using var client = new SmtpClient();
            var secureOption = useSsl
                ? SecureSocketOptions.SslOnConnect
                : useTls ? SecureSocketOptions.StartTls : SecureSocketOptions.None;

            await client.ConnectAsync(host, port, secureOption);
            await client.AuthenticateAsync(user, password);
            await client.SendAsync(message);
            await client.DisconnectAsync(true);

            _log.LogInformation("Email sent to {To}: {Subject}", to, subject);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Email send failed to {To}: {Subject}", to, subject);
            throw;
        }
    }
}
