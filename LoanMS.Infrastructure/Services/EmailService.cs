using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using LoanMS.Application.Interfaces;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MimeKit;

namespace LoanMS.Infrastructure.Services;

/// <summary>
/// Unified, server-side email service — the single sender for the whole app.
///
/// Config resolution order:
///   1. DB (IEmailConfigStore) — whatever Admin last saved in Settings → Mail & Email.
///   2. appsettings.json "Email" section — bootstrap fallback for a fresh install
///      where nobody has configured Settings Center yet.
///
/// Providers:
///   - "smtp"  → MailKit, works with Gmail (App Password), Office365, or any SMTP host.
///   - "brevo" → Brevo HTTP transactional API, called from the SERVER (not the
///                browser), so there's no CORS issue and the API key is never
///                exposed to the client.
///
/// Every email call site in the app (invitation, password reset, loan status
/// emails, EMI reminders, etc.) ultimately funnels through <see cref="SendAsync"/>
/// or <see cref="SendPasswordResetEmailAsync"/> — there is no other code path
/// that sends mail.
/// </summary>
public class EmailService : IEmailService
{
    private readonly IEmailConfigStore    _configStore;
    private readonly IConfiguration       _cfg;
    private readonly IHttpClientFactory   _httpFactory;
    private readonly ILogger<EmailService> _log;

    public EmailService(
        IEmailConfigStore configStore,
        IConfiguration cfg,
        IHttpClientFactory httpFactory,
        ILogger<EmailService> log)
    {
        _configStore = configStore;
        _cfg         = cfg;
        _httpFactory = httpFactory;
        _log         = log;
    }

    // ── Public API ───────────────────────────────────────────────────────────

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

        await SendAsync(toEmail, toName, subject, htmlBody);
    }

    public async Task SendAsync(string toEmail, string toName, string subject, string htmlBody, string? cc = null, string? replyTo = null)
    {
        var resolved = await ResolveConfigAsync();

        if (resolved is null)
        {
            _log.LogWarning("Email not configured (no DB config and no appsettings.json fallback) — skipping send to {To}", toEmail);
            throw new InvalidOperationException(
                "Email is not configured yet. Go to Settings → Mail & Email, fill in the provider details, and save.");
        }

        if ((resolved.Provider ?? "smtp").Equals("brevo", StringComparison.OrdinalIgnoreCase))
        {
            await SendViaBrevoAsync(resolved, toEmail, toName, subject, htmlBody, cc, replyTo);
        }
        else
        {
            await SendViaSmtpAsync(resolved, toEmail, toName, subject, htmlBody, cc, replyTo);
        }

        _log.LogInformation("Email sent to {To} via {Provider}: {Subject}", toEmail, resolved.Provider, subject);
    }

    public async Task<(bool Success, string? Error)> SendTestEmailAsync(string toEmail)
    {
        try
        {
            var html = """
                <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto">
                  <h2 style="color:#1a4fa3">EFIN — Test Email ✓</h2>
                  <p>This is a test email from LoanMS Settings → Mail &amp; Email.</p>
                  <p style="color:#6b7280;font-size:13px">If you received this, your email configuration is working correctly.</p>
                </div>
                """;
            await SendAsync(toEmail, "Admin", "EFIN — Test Email ✓", html);
            return (true, null);
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Test email failed to {To}", toEmail);
            return (false, ex.Message);
        }
    }

    // ── Config resolution ────────────────────────────────────────────────────

    private class ResolvedConfig
    {
        public string Provider   = "smtp";
        public string FromEmail  = "";
        public string FromName   = "LoanMS";
        public string SmtpHost   = "smtp.gmail.com";
        public int    SmtpPort   = 587;
        public string SmtpUser   = "";
        public string SmtpPass   = "";
        public bool   SmtpUseSsl = false;
        public string ApiKey     = "";
    }

    private async Task<ResolvedConfig?> ResolveConfigAsync()
    {
        // 1. DB-backed config (Settings → Mail & Email) — authoritative when present.
        var db = await _configStore.GetAsync();
        if (db is not null && !string.IsNullOrWhiteSpace(db.FromEmail))
        {
            var provider = (db.Provider ?? "smtp").ToLowerInvariant();
            if (provider == "brevo")
            {
                if (string.IsNullOrWhiteSpace(db.ApiKey)) return null;
                return new ResolvedConfig
                {
                    Provider  = "brevo",
                    FromEmail = db.FromEmail,
                    FromName  = string.IsNullOrWhiteSpace(db.Name) ? "LoanMS" : db.Name,
                    ApiKey    = db.ApiKey
                };
            }

            if (string.IsNullOrWhiteSpace(db.SmtpUser) || string.IsNullOrWhiteSpace(db.SmtpPass)) return null;
            return new ResolvedConfig
            {
                Provider   = "smtp",
                FromEmail  = string.IsNullOrWhiteSpace(db.FromEmail) ? db.SmtpUser : db.FromEmail,
                FromName   = string.IsNullOrWhiteSpace(db.Name) ? "LoanMS" : db.Name,
                SmtpHost   = string.IsNullOrWhiteSpace(db.SmtpHost) ? "smtp.gmail.com" : db.SmtpHost,
                SmtpPort   = int.TryParse(db.SmtpPort, out var p) ? p : 587,
                SmtpUser   = db.SmtpUser,
                SmtpPass   = db.SmtpPass,
                SmtpUseSsl = db.SmtpUseSsl
            };
        }

        // 2. appsettings.json fallback — lets a fresh install work before anyone
        //    touches Settings Center, using LoanMS.API/appsettings*.json "Email" section.
        var cfgUser = _cfg["Email:User"] ?? _cfg["Email:SmtpUser"] ?? string.Empty;
        var cfgPass = _cfg["Email:Password"] ?? _cfg["Email:SmtpPassword"] ?? string.Empty;
        if (string.IsNullOrEmpty(cfgUser) || string.IsNullOrEmpty(cfgPass)) return null;

        var cfgPortStr = _cfg["Email:Port"] ?? _cfg["Email:SmtpPort"] ?? "587";
        return new ResolvedConfig
        {
            Provider   = "smtp",
            FromEmail  = _cfg["Email:FromAddress"] ?? cfgUser,
            FromName   = _cfg["Email:FromName"] ?? "LoanMS",
            SmtpHost   = _cfg["Email:Host"] ?? _cfg["Email:SmtpHost"] ?? "smtp.gmail.com",
            SmtpPort   = int.TryParse(cfgPortStr, out var p2) ? p2 : 587,
            SmtpUser   = cfgUser,
            SmtpPass   = cfgPass,
            SmtpUseSsl = _cfg.GetValue<bool>("Email:UseSsl")
        };
    }

    // ── SMTP delivery (MailKit) ─────────────────────────────────────────────

    private async Task SendViaSmtpAsync(ResolvedConfig cfg, string to, string toName, string subject, string htmlBody, string? cc, string? replyTo)
    {
        var message = new MimeMessage();
        message.From.Add(new MailboxAddress(cfg.FromName, cfg.FromEmail));
        message.To.Add(MailboxAddress.Parse(to));
        if (!string.IsNullOrWhiteSpace(cc)) message.Cc.Add(MailboxAddress.Parse(cc));
        if (!string.IsNullOrWhiteSpace(replyTo)) message.ReplyTo.Add(MailboxAddress.Parse(replyTo));
        message.Subject = subject;
        message.Body    = new TextPart("html") { Text = htmlBody };

        // Hard timeout — MailKit's default socket timeout is 100s. On hosts where
        // the outbound SMTP port is firewalled, that makes the request (and the
        // caller's UI) look "frozen" for a minute-plus before finally failing.
        // 15s is generous for a real connection and fails fast when the port is
        // simply unreachable, so the error surfaces immediately instead of hanging.
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));

        try
        {
            using var client = new SmtpClient { Timeout = 15000 };
            var secureOption = cfg.SmtpUseSsl
                ? SecureSocketOptions.SslOnConnect   // port 465
                : SecureSocketOptions.StartTls;      // port 587

            await client.ConnectAsync(cfg.SmtpHost, cfg.SmtpPort, secureOption, cts.Token);
            await client.AuthenticateAsync(cfg.SmtpUser, cfg.SmtpPass, cts.Token);
            await client.SendAsync(message, cts.Token);
            await client.DisconnectAsync(true, cts.Token);
        }
        catch (OperationCanceledException)
        {
            _log.LogError("SMTP connect/send to {Host}:{Port} timed out after 15s (To: {To})", cfg.SmtpHost, cfg.SmtpPort, to);
            throw new InvalidOperationException(
                $"Could not reach {cfg.SmtpHost}:{cfg.SmtpPort} within 15s. Your hosting provider's firewall may be blocking outbound SMTP — try port 465 with SSL enabled, or confirm the port is open.");
        }
        catch (MailKit.Security.AuthenticationException ex)
        {
            _log.LogError(ex, "SMTP auth rejected for {User} @ {Host}", cfg.SmtpUser, cfg.SmtpHost);
            throw new InvalidOperationException(
                "Gmail rejected the login. Make sure 2-Step Verification is ON for this Gmail account and you're using a 16-character App Password (not your normal Gmail password) — generate one at myaccount.google.com/apppasswords.");
        }
        catch (System.Net.Sockets.SocketException ex)
        {
            _log.LogError(ex, "SMTP socket error connecting to {Host}:{Port}", cfg.SmtpHost, cfg.SmtpPort);
            throw new InvalidOperationException(
                $"Could not connect to {cfg.SmtpHost}:{cfg.SmtpPort} — the connection was refused or the network is blocking it. Check your server's outbound firewall rules for SMTP.");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "SMTP send failed to {To}: {Subject}", to, subject);
            throw new InvalidOperationException($"SMTP send failed: {ex.Message}", ex);
        }
    }

    // ── Brevo delivery (server-side HTTP call — no CORS, no client-exposed key) ──

    private async Task SendViaBrevoAsync(ResolvedConfig cfg, string to, string toName, string subject, string htmlBody, string? cc, string? replyTo)
    {
        var client = _httpFactory.CreateClient();
        client.BaseAddress = new Uri("https://api.brevo.com/");

        var payload = new Dictionary<string, object?>
        {
            ["sender"]      = new { name = cfg.FromName, email = cfg.FromEmail },
            ["to"]          = new[] { new { email = to, name = string.IsNullOrWhiteSpace(toName) ? to : toName } },
            ["subject"]     = subject,
            ["htmlContent"] = htmlBody
        };
        if (!string.IsNullOrWhiteSpace(cc))      payload["cc"]      = new[] { new { email = cc } };
        if (!string.IsNullOrWhiteSpace(replyTo)) payload["replyTo"] = new { email = replyTo };

        using var req = new HttpRequestMessage(HttpMethod.Post, "v3/smtp/email")
        {
            Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
        };
        req.Headers.TryAddWithoutValidation("api-key", cfg.ApiKey);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        try
        {
            using var res = await client.SendAsync(req);
            if (!res.IsSuccessStatusCode)
            {
                var body = await res.Content.ReadAsStringAsync();
                string? message = null;
                try
                {
                    using var doc = JsonDocument.Parse(body);
                    if (doc.RootElement.TryGetProperty("message", out var m)) message = m.GetString();
                }
                catch { /* body wasn't JSON — fall through to raw body */ }

                throw new InvalidOperationException(
                    $"Brevo API error (HTTP {(int)res.StatusCode}): {message ?? body}");
            }
        }
        catch (InvalidOperationException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Brevo send failed to {To}: {Subject}", to, subject);
            throw new InvalidOperationException($"Brevo send failed: {ex.Message}", ex);
        }
    }
}
