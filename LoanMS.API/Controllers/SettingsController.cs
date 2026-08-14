using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace LoanMS.API.Controllers;

[Authorize(Roles = "Admin")]
public class SettingsController : BaseController
{
    private readonly AppDbContext _db;
    private readonly IDataProtector _protector;
    private readonly IDataProtector _aiKeyProtector;
    private readonly LoanMS.Infrastructure.Services.IEmailConfigStore _emailConfigStore;
    private readonly LoanMS.Application.Interfaces.IEmailService _emailService;

    // Keys used to store InCred credentials in AppSettings table
    private const string KEY_INCRED_BASE_URL = "incred_base_url";
    private const string KEY_INCRED_CLIENT_ID = "incred_client_id";
    private const string KEY_INCRED_CLIENT_SECRET = "incred_client_secret_enc"; // encrypted

    // Keys used to store AI provider (Gemini / OpenAI) API keys in AppSettings table.
    // Same names as LoanMS.Infrastructure.AI.AiKeyStore — that's what actually reads
    // these at request time to authenticate the real Gemini/OpenAI calls.
    private const string KEY_AI_GEMINI_ENC = LoanMS.Infrastructure.AI.AiKeyStore.KeyGeminiEnc;
    private const string KEY_AI_OPENAI_ENC = LoanMS.Infrastructure.AI.AiKeyStore.KeyOpenAiEnc;

    public SettingsController(
        AppDbContext db,
        IDataProtectionProvider dpProvider,
        LoanMS.Infrastructure.Services.IEmailConfigStore emailConfigStore,
        LoanMS.Application.Interfaces.IEmailService emailService)
    {
        _db = db;
        _protector = dpProvider.CreateProtector("LoanMS.InCredSecrets.v1");
        // Must match LoanMS.Infrastructure.AI.AiKeyStore.DataProtectionPurpose exactly,
        // so a key saved here is decryptable there (and vice versa).
        _aiKeyProtector = dpProvider.CreateProtector(LoanMS.Infrastructure.AI.AiKeyStore.DataProtectionPurpose);
        _emailConfigStore = emailConfigStore;
        _emailService = emailService;
    }

    // ── InCred Credentials — Save (Admin only) ────────────────────────────────
    [HttpPost("incred-credentials")]
    public async Task<IActionResult> SaveIncredCredentials([FromBody] IncredCredentialsDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.BaseUrl) ||
            string.IsNullOrWhiteSpace(dto.ClientId) ||
            string.IsNullOrWhiteSpace(dto.ClientSecret))
            return BadRequest(ApiResponseDto<bool>.Fail("BaseUrl, ClientId and ClientSecret are required."));

        try { _ = new Uri(dto.BaseUrl); }
        catch { return BadRequest(ApiResponseDto<bool>.Fail("BaseUrl is not a valid URL.")); }

        // Encrypt the client secret before storing
        var encryptedSecret = _protector.Protect(dto.ClientSecret);

        await UpsertSettingInternal(KEY_INCRED_BASE_URL,      dto.BaseUrl.TrimEnd('/'), "incred");
        await UpsertSettingInternal(KEY_INCRED_CLIENT_ID,     dto.ClientId.Trim(),      "incred");
        await UpsertSettingInternal(KEY_INCRED_CLIENT_SECRET, encryptedSecret,           "incred");

        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "InCred credentials saved securely."));
    }

    // ── InCred Credentials — Load (Admin only, secret is masked) ─────────────
    [HttpGet("incred-credentials")]
    public async Task<IActionResult> GetIncredCredentials()
    {
        var baseUrl  = await GetSettingValue(KEY_INCRED_BASE_URL);
        var clientId = await GetSettingValue(KEY_INCRED_CLIENT_ID);
        var encSec   = await GetSettingValue(KEY_INCRED_CLIENT_SECRET);

        bool configured = !string.IsNullOrEmpty(baseUrl) &&
                          !string.IsNullOrEmpty(clientId) &&
                          !string.IsNullOrEmpty(encSec);

        return Ok(ApiResponseDto<object>.Ok(new
        {
            configured,
            baseUrl   = baseUrl ?? "",
            clientId  = clientId ?? "",
            // Never return the real secret — return a masked placeholder so the UI
            // can show that a secret is saved without exposing it.
            clientSecretMasked = configured ? "••••••••••••••••" : ""
        }));
    }

    // ── InCred Credentials — Clear (Admin only) ───────────────────────────────
    [HttpDelete("incred-credentials")]
    public async Task<IActionResult> ClearIncredCredentials()
    {
        foreach (var key in new[] { KEY_INCRED_BASE_URL, KEY_INCRED_CLIENT_ID, KEY_INCRED_CLIENT_SECRET })
        {
            var s = await _db.AppSettings.FirstOrDefaultAsync(x => x.Key == key);
            if (s != null) { s.IsDeleted = true; s.UpdatedAt = DateTime.UtcNow; }
        }
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "InCred credentials cleared."));
    }

    // ── Internal helper used by IncredController to read the decrypted secret ─
    // (Not an HTTP endpoint — called internally)
    public async Task<IncredCredentialsPlain?> GetDecryptedIncredCredentials()
    {
        var baseUrl  = await GetSettingValue(KEY_INCRED_BASE_URL);
        var clientId = await GetSettingValue(KEY_INCRED_CLIENT_ID);
        var encSec   = await GetSettingValue(KEY_INCRED_CLIENT_SECRET);

        if (string.IsNullOrEmpty(baseUrl) || string.IsNullOrEmpty(clientId) || string.IsNullOrEmpty(encSec))
            return null;

        try
        {
            var secret = _protector.Unprotect(encSec);
            return new IncredCredentialsPlain { BaseUrl = baseUrl, ClientId = clientId, ClientSecret = secret };
        }
        catch { return null; }
    }

    // ── Email Config — Save (Admin only, secrets encrypted at rest) ────────────
    // Single source of truth: LoanMS.Infrastructure.Services.EmailConfigStore.
    // EmailService reads the exact same store, so whatever is saved here is
    // immediately live for every email the app sends — no appsettings.json edit,
    // no restart, no separate frontend-only config needed.

    [HttpPost("email-config")]
    public async Task<IActionResult> SaveEmailConfig([FromBody] EmailConfigDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.FromEmail))
            return BadRequest(ApiResponseDto<bool>.Fail("From Email Address is required."));
        if (string.IsNullOrWhiteSpace(dto.Name))
            return BadRequest(ApiResponseDto<bool>.Fail("Sender Display Name is required."));

        var provider = string.IsNullOrWhiteSpace(dto.Provider) ? "smtp" : dto.Provider.Trim().ToLowerInvariant();

        if (provider == "brevo")
        {
            if (string.IsNullOrWhiteSpace(dto.ApiKey))
                return BadRequest(ApiResponseDto<bool>.Fail("Brevo API Key is required."));
        }
        else
        {
            provider = "smtp";
            if (string.IsNullOrWhiteSpace(dto.SmtpUser))
                return BadRequest(ApiResponseDto<bool>.Fail("SMTP / Gmail address is required."));
            if (string.IsNullOrWhiteSpace(dto.SmtpPass))
                return BadRequest(ApiResponseDto<bool>.Fail("SMTP / Gmail App Password is required."));
        }

        // If a masked placeholder comes back from the UI (user didn't touch the
        // secret field), keep the previously-saved secret instead of overwriting
        // it with the mask string.
        var existing = await _emailConfigStore.GetAsync();

        var record = new LoanMS.Infrastructure.Services.EmailConfigRecord
        {
            Provider   = provider,
            FromEmail  = dto.FromEmail.Trim(),
            Name       = dto.Name.Trim(),
            Cc         = dto.Cc?.Trim() ?? string.Empty,
            ReplyTo    = dto.ReplyTo?.Trim() ?? string.Empty,
            Signature  = dto.Signature ?? string.Empty,
            SmtpHost   = string.IsNullOrWhiteSpace(dto.SmtpHost) ? "smtp.gmail.com" : dto.SmtpHost.Trim(),
            SmtpPort   = string.IsNullOrWhiteSpace(dto.SmtpPort) ? "587" : dto.SmtpPort.Trim(),
            SmtpUser   = dto.SmtpUser?.Trim() ?? string.Empty,
            SmtpPass   = IsMasked(dto.SmtpPass) ? (existing?.SmtpPass ?? string.Empty) : (dto.SmtpPass ?? string.Empty),
            SmtpUseSsl = dto.SmtpUseSsl,
            ApiKey     = IsMasked(dto.ApiKey) ? (existing?.ApiKey ?? string.Empty) : (dto.ApiKey ?? string.Empty),
            InvEnabled = dto.InvEnabled,
            InvSubject = dto.InvSubject ?? string.Empty,
            InvBody    = dto.InvBody ?? string.Empty,
        };

        await _emailConfigStore.SaveAsync(record);
        return Ok(ApiResponseDto<bool>.Ok(true, "Email configuration saved securely."));
    }

    private static bool IsMasked(string? value) =>
        !string.IsNullOrEmpty(value) && value.All(c => c == '•');

    [HttpGet("email-config")]
    public async Task<IActionResult> GetEmailConfig()
    {
        var cfg = await _emailConfigStore.GetAsync();
        if (cfg is null || string.IsNullOrEmpty(cfg.FromEmail))
            return Ok(ApiResponseDto<object>.Ok(new { configured = false }));

        return Ok(ApiResponseDto<object>.Ok(new
        {
            configured  = true,
            provider    = cfg.Provider,
            fromEmail   = cfg.FromEmail,
            name        = cfg.Name,
            cc          = cfg.Cc,
            replyTo     = cfg.ReplyTo,
            signature   = cfg.Signature,
            smtpHost    = cfg.SmtpHost,
            smtpPort    = cfg.SmtpPort,
            smtpUser    = cfg.SmtpUser,       // not secret — just an address
            smtpUseSsl  = cfg.SmtpUseSsl,
            invEnabled  = cfg.InvEnabled,
            invSubject  = cfg.InvSubject,
            invBody     = cfg.InvBody,
            // Secrets: never return the real value — only whether one is set,
            // plus a masked placeholder the UI can show in the field.
            hasApiKey   = !string.IsNullOrEmpty(cfg.ApiKey),
            hasSmtpPass = !string.IsNullOrEmpty(cfg.SmtpPass),
            apiKeyMasked   = !string.IsNullOrEmpty(cfg.ApiKey)   ? "••••••••••••••••" : "",
            smtpPassMasked = !string.IsNullOrEmpty(cfg.SmtpPass) ? "••••••••••••••••" : "",
        }));
    }

    [HttpDelete("email-config")]
    public async Task<IActionResult> ClearEmailConfig()
    {
        await _emailConfigStore.ClearAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Email configuration cleared."));
    }

    // ── Email Config — Send a real test email through the currently-saved config ──
    [HttpPost("email-config/test")]
    public async Task<IActionResult> TestEmailConfig([FromBody] EmailTestDto dto)
    {
        if (string.IsNullOrWhiteSpace(dto.ToEmail))
            return BadRequest(ApiResponseDto<bool>.Fail("Enter an email address to send the test to."));

        var (success, error) = await _emailService.SendTestEmailAsync(dto.ToEmail.Trim());
        if (!success)
            return Ok(ApiResponseDto<bool>.Fail(error ?? "Test email failed — check server logs for details."));

        return Ok(ApiResponseDto<bool>.Ok(true, "Test email sent — check the inbox (and spam folder)."));
    }


    // ── AI Provider Keys — Gemini & OpenAI (Admin only, encrypted at rest) ────
    // These are the real, server-side keys used to authenticate KYC Vision
    // extraction and AI text features against Google Gemini / OpenAI. Saving
    // a key here takes effect on the very next request — no restart needed
    // (see LoanMS.Infrastructure.AI.AiKeyStore, GeminiAIProvider, OpenAIProvider).
    [HttpGet("ai-keys")]
    public async Task<IActionResult> GetAiKeys()
    {
        var geminiEnc = await GetSettingValue(KEY_AI_GEMINI_ENC);
        var openaiEnc = await GetSettingValue(KEY_AI_OPENAI_ENC);

        return Ok(ApiResponseDto<object>.Ok(new
        {
            gemini = new
            {
                configured = !string.IsNullOrEmpty(geminiEnc),
                masked     = !string.IsNullOrEmpty(geminiEnc) ? "••••••••••••••••" : ""
            },
            openai = new
            {
                configured = !string.IsNullOrEmpty(openaiEnc),
                masked     = !string.IsNullOrEmpty(openaiEnc) ? "••••••••••••••••" : ""
            }
        }));
    }

    [HttpPost("ai-keys")]
    public async Task<IActionResult> SaveAiKey([FromBody] AiKeyDto dto)
    {
        var provider = (dto.Provider ?? string.Empty).Trim().ToLowerInvariant();
        if (provider != "gemini" && provider != "openai")
            return BadRequest(ApiResponseDto<bool>.Fail("Provider must be 'gemini' or 'openai'."));
        if (string.IsNullOrWhiteSpace(dto.ApiKey))
            return BadRequest(ApiResponseDto<bool>.Fail("API key is required."));

        var settingKey = provider == "gemini" ? KEY_AI_GEMINI_ENC : KEY_AI_OPENAI_ENC;
        var encrypted  = _aiKeyProtector.Protect(dto.ApiKey.Trim());

        await UpsertSettingInternal(settingKey, encrypted, "ai");
        await _db.SaveChangesAsync();

        var label = provider == "gemini" ? "Gemini" : "OpenAI";
        return Ok(ApiResponseDto<bool>.Ok(true, $"{label} API key saved. It will be used on the next AI request."));
    }

    [HttpDelete("ai-keys/{provider}")]
    public async Task<IActionResult> ClearAiKey(string provider)
    {
        provider = (provider ?? string.Empty).Trim().ToLowerInvariant();
        if (provider != "gemini" && provider != "openai")
            return BadRequest(ApiResponseDto<bool>.Fail("Provider must be 'gemini' or 'openai'."));

        var settingKey = provider == "gemini" ? KEY_AI_GEMINI_ENC : KEY_AI_OPENAI_ENC;
        var s = await _db.AppSettings.FirstOrDefaultAsync(x => x.Key == settingKey);
        if (s != null) { s.IsDeleted = true; s.UpdatedAt = DateTime.UtcNow; }
        await _db.SaveChangesAsync();

        return Ok(ApiResponseDto<bool>.Ok(true, "API key removed. Falling back to server config, if any."));
    }

    private async Task<string?> GetSettingValue(string key)
    {
        var s = await _db.AppSettings.FirstOrDefaultAsync(x => x.Key == key);
        return s?.Value;
    }

    // ── Webhook Logs — Admin only (Settings → System & Data) ─────────────────
    // Reads the same "incred_webhook_logs" AppSettings key that IncredController's
    // webhook receiver writes to. Added here (instead of using IncredController's
    // own GET /api/incred/webhook/logs) because, at the time, that controller was
    // class-level [AllowAnonymous] — needed for the inbound InCred webhook
    // callback itself — which meant a logs GET placed there would have been
    // unintentionally readable by anyone, including unauthenticated requests.
    // PHASE 6 UPDATE: IncredController is now [Authorize] at the class level,
    // with [AllowAnonymous] narrowed down to just the one inbound webhook
    // receiver method — but this Admin-gated copy here remains the correct,
    // intentionally-separate home for the logs view regardless, so it's kept
    // as-is rather than moved.
    private const string KEY_INCRED_WEBHOOK_LOGS = "incred_webhook_logs";

    [HttpGet("webhook-logs")]
    public async Task<IActionResult> GetWebhookLogs()
    {
        var raw = await GetSettingValue(KEY_INCRED_WEBHOOK_LOGS);
        if (string.IsNullOrEmpty(raw))
            return Ok(new { logs = Array.Empty<object>() });

        try
        {
            var logs = JsonSerializer.Deserialize<List<JsonElement>>(raw) ?? new();
            return Ok(new { logs });
        }
        catch
        {
            return Ok(new { logs = Array.Empty<object>() });
        }
    }

    private async Task UpsertSettingInternal(string key, string value, string category)
    {
        var existing = await _db.AppSettings.FirstOrDefaultAsync(s => s.Key == key);
        if (existing != null)
        {
            existing.Value = value; existing.Category = category;
            existing.UpdatedAt = DateTime.UtcNow; existing.IsDeleted = false;
        }
        else
        {
            _db.AppSettings.Add(new AppSetting
            {
                Key = key, Value = value,
                Category = category, CreatedAt = DateTime.UtcNow
            });
        }
    }

    [HttpGet]
    public async Task<IActionResult> GetAll([FromQuery] string? category)
    {
        var q = _db.AppSettings.AsQueryable();
        if (!string.IsNullOrEmpty(category)) q = q.Where(s => s.Category == category);
        var settings = await q.Select(s => new { s.Id, s.Key, s.Value, s.Category }).ToListAsync();
        return Ok(ApiResponseDto<object>.Ok(settings));
    }

    [Microsoft.AspNetCore.Authorization.AllowAnonymous]
    [HttpGet("{key}")]
    public async Task<IActionResult> Get(string key)
    {
        // BUGFIX (confirmed real bug — 403s reported in live console for
        // every non-Admin role): this generic GET-by-key endpoint inherited
        // the class-level [Authorize(Roles="Admin")], meaning ONLY Admin
        // could read ANY setting through it — including branding keys
        // (efin_logo, efin_banner_logo, efin_brand_name, etc.) that every
        // role, and even the pre-login page, needs to render the logo.
        // Method-level [AllowAnonymous] overrides the class attribute, but
        // to avoid turning this into "any key readable by anyone" (which
        // would leak things like incred_credentials or efin_role_permissions
        // to non-Admins), only this small, explicit whitelist of genuinely
        // public branding keys bypasses the check; everything else still
        // enforces the exact same Admin-only rule as before, just done
        // manually here instead of via the attribute.
        var publicKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "efin_logo", "efin_banner_logo", "efin_logo_icon_size",
            "efin_logo_banner_size", "efin_brand_name", "efin_brand_sub",
            // These two are read (not written) by every role during normal
            // use — CAM salary-band display, InCred comment-template
            // picker — not Admin-only data, just Admin-editable.
            "efin_cam_matrix", "efin_incred_comment_templates"
        };
        if (!publicKeys.Contains(key))
        {
            if (!(User.Identity?.IsAuthenticated ?? false) || !User.IsInRole("Admin"))
                return Forbid();
        }

        var setting = await _db.AppSettings.FirstOrDefaultAsync(s => s.Key == key);
        if (setting == null) return NotFound(ApiResponseDto<bool>.Fail("Setting not found."));
        return Ok(ApiResponseDto<object>.Ok(new { setting.Key, setting.Value, setting.Category }));
    }

    [HttpPost]
    public async Task<IActionResult> Upsert([FromBody] SettingDto dto)
    {
        var existing = await _db.AppSettings.FirstOrDefaultAsync(s => s.Key == dto.Key);
        if (existing != null) {
            existing.Value = dto.Value; existing.Category = dto.Category;
            existing.UpdatedAt = DateTime.UtcNow;
        } else {
            _db.AppSettings.Add(new AppSetting {
                Key = dto.Key, Value = dto.Value,
                Category = dto.Category, CreatedAt = DateTime.UtcNow
            });
        }
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Setting saved."));
    }

    [HttpPost("batch")]
    public async Task<IActionResult> UpsertBatch([FromBody] List<SettingDto> settings)
    {
        foreach (var dto in settings) {
            var existing = await _db.AppSettings.FirstOrDefaultAsync(s => s.Key == dto.Key);
            if (existing != null) {
                existing.Value = dto.Value; existing.UpdatedAt = DateTime.UtcNow;
            } else {
                _db.AppSettings.Add(new AppSetting { Key = dto.Key, Value = dto.Value, Category = dto.Category, CreatedAt = DateTime.UtcNow });
            }
        }
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, $"{settings.Count} settings saved."));
    }

    [HttpDelete("{key}")]
    public async Task<IActionResult> Delete(string key)
    {
        var setting = await _db.AppSettings.FirstOrDefaultAsync(s => s.Key == key);
        if (setting == null) return NotFound(ApiResponseDto<bool>.Fail("Not found."));
        setting.IsDeleted = true; setting.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Deleted."));
    }
    /// <summary>
    /// Public endpoint — returns the custom sign-in logo (base64 dataUrl).
    /// Called by the login page before authentication.
    /// </summary>
    [Microsoft.AspNetCore.Authorization.AllowAnonymous]
    [HttpGet("signin-logo")]
    public async Task<IActionResult> GetSigninLogoPublic()
    {
        var setting = await _db.AppSettings.FirstOrDefaultAsync(s => s.Key == "efin_signin_logo");
        if (setting == null || string.IsNullOrEmpty(setting.Value))
            return Ok(new { logo = (string?)null });
        return Ok(new { logo = setting.Value });
    }

    /// <summary>
    /// Save or remove the sign-in logo (base64 dataUrl). Admin only.
    /// </summary>
    [HttpPost("signin-logo")]
    public async Task<IActionResult> SaveSigninLogo([FromBody] SigninLogoDto dto)
    {
        await UpsertSettingInternal("efin_signin_logo", dto.Logo ?? "", "branding");
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Sign-in logo saved."));
    }


}

public class SettingDto {
    public string Key { get; set; } = string.Empty;
    public string Value { get; set; } = string.Empty;
    public string? Category { get; set; }
}

public class IncredCredentialsDto {
    public string BaseUrl      { get; set; } = string.Empty;
    public string ClientId     { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
}

public class IncredCredentialsPlain {
    public string BaseUrl      { get; set; } = string.Empty;
    public string ClientId     { get; set; } = string.Empty;
    public string ClientSecret { get; set; } = string.Empty;
}

public class SigninLogoDto {
    public string? Logo { get; set; }
}

public class AiKeyDto {
    public string Provider { get; set; } = string.Empty; // "gemini" | "openai"
    public string ApiKey   { get; set; } = string.Empty;
}

public class EmailConfigDto {
    public string Provider    { get; set; } = string.Empty; // "smtp" | "brevo"
    public string FromEmail   { get; set; } = string.Empty;
    public string Name        { get; set; } = string.Empty;
    public string Cc          { get; set; } = string.Empty;
    public string ReplyTo     { get; set; } = string.Empty;
    public string Signature   { get; set; } = string.Empty;
    public string SmtpHost    { get; set; } = string.Empty;
    public string SmtpPort    { get; set; } = string.Empty;
    public bool   SmtpUseSsl  { get; set; } = false;
    // Sensitive — encrypted in storage, never returned in GET response
    public string ApiKey      { get; set; } = string.Empty;
    public string SmtpUser    { get; set; } = string.Empty;
    public string SmtpPass    { get; set; } = string.Empty;
    // Invitation email preferences (now DB-backed, not localStorage-only)
    public bool   InvEnabled  { get; set; } = true;
    public string InvSubject  { get; set; } = string.Empty;
    public string InvBody     { get; set; } = string.Empty;
}

public class EmailTestDto {
    public string ToEmail { get; set; } = string.Empty;
}
