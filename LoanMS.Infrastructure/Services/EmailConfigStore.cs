using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Services;

/// <summary>
/// Full, unified email configuration record — one shape for both providers
/// (SMTP and Brevo) plus invitation-template preferences. This is the ONLY
/// place email settings are persisted; Settings Center (frontend) reads and
/// writes this via SettingsController, and EmailService reads it to actually
/// send mail. No more parallel localStorage / appsettings.json copies.
/// </summary>
public class EmailConfigRecord
{
    public string Provider   { get; set; } = "smtp"; // "smtp" | "brevo"
    public string FromEmail  { get; set; } = string.Empty;
    public string Name       { get; set; } = string.Empty;
    public string Cc         { get; set; } = string.Empty;
    public string ReplyTo    { get; set; } = string.Empty;
    public string Signature  { get; set; } = string.Empty;

    // SMTP (used when Provider == "smtp"; sent server-side via MailKit)
    public string SmtpHost   { get; set; } = "smtp.gmail.com";
    public string SmtpPort   { get; set; } = "587";
    public string SmtpUser   { get; set; } = string.Empty;
    public string SmtpPass   { get; set; } = string.Empty;
    public bool   SmtpUseSsl { get; set; } = false; // true => SSL-on-connect (port 465), false => STARTTLS (port 587)

    // Brevo (used when Provider == "brevo"; sent server-side via HTTP API — no CORS/browser key exposure)
    public string ApiKey     { get; set; } = string.Empty;

    // Invitation email preferences (moved here from the old localStorage-only config
    // so Settings Center is fully DB-backed, not just the secrets)
    public bool   InvEnabled { get; set; } = true;
    public string InvSubject { get; set; } = string.Empty;
    public string InvBody    { get; set; } = string.Empty;
}

public interface IEmailConfigStore
{
    Task<EmailConfigRecord?> GetAsync();
    Task SaveAsync(EmailConfigRecord cfg);
    Task ClearAsync();
}

/// <summary>
/// DB-first email config store. Same Data Protection purpose string used
/// consistently by every reader/writer, so a config saved from Settings
/// Center is immediately usable by EmailService without any restart or
/// appsettings.json edit.
/// </summary>
public class EmailConfigStore : IEmailConfigStore
{
    public const string DataProtectionPurpose = "LoanMS.EmailConfig.v1";
    public const string Key = "email_config_enc_v2";

    private readonly AppDbContext _db;
    private readonly IDataProtector _protector;

    public EmailConfigStore(AppDbContext db, IDataProtectionProvider dpProvider)
    {
        _db = db;
        _protector = dpProvider.CreateProtector(DataProtectionPurpose);
    }

    public async Task<EmailConfigRecord?> GetAsync()
    {
        var row = await _db.AppSettings.AsNoTracking()
            .FirstOrDefaultAsync(s => s.Key == Key && !s.IsDeleted);
        if (row == null || string.IsNullOrEmpty(row.Value)) return null;

        try
        {
            var json = _protector.Unprotect(row.Value);
            return System.Text.Json.JsonSerializer.Deserialize<EmailConfigRecord>(json);
        }
        catch
        {
            // Corrupt/undecryptable row (e.g. Data Protection keys rotated elsewhere) —
            // treat as unconfigured rather than throwing, so the app keeps working.
            return null;
        }
    }

    public async Task SaveAsync(EmailConfigRecord cfg)
    {
        var json = System.Text.Json.JsonSerializer.Serialize(cfg);
        var encrypted = _protector.Protect(json);

        var existing = await _db.AppSettings.FirstOrDefaultAsync(s => s.Key == Key);
        if (existing != null)
        {
            existing.Value = encrypted;
            existing.Category = "email";
            existing.UpdatedAt = DateTime.UtcNow;
            existing.IsDeleted = false;
        }
        else
        {
            _db.AppSettings.Add(new AppSetting
            {
                Key = Key,
                Value = encrypted,
                Category = "email",
                CreatedAt = DateTime.UtcNow
            });
        }

        await _db.SaveChangesAsync();
    }

    public async Task ClearAsync()
    {
        var row = await _db.AppSettings.FirstOrDefaultAsync(s => s.Key == Key);
        if (row != null)
        {
            row.IsDeleted = true;
            row.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }
    }
}
