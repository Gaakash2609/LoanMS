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

    // Keys used to store InCred credentials in AppSettings table
    private const string KEY_INCRED_BASE_URL = "incred_base_url";
    private const string KEY_INCRED_CLIENT_ID = "incred_client_id";
    private const string KEY_INCRED_CLIENT_SECRET = "incred_client_secret_enc"; // encrypted

    public SettingsController(AppDbContext db, IDataProtectionProvider dpProvider)
    {
        _db = db;
        _protector = dpProvider.CreateProtector("LoanMS.InCredSecrets.v1");
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
    private const string KEY_EMAIL_CFG = "email_config_enc_v1";

    [HttpPost("email-config")]
    public async Task<IActionResult> SaveEmailConfig([FromBody] EmailConfigDto dto)
    {
        // Serialize full config and encrypt it before storing
        var json = System.Text.Json.JsonSerializer.Serialize(dto);
        var encrypted = _protector.Protect(json);
        await UpsertSettingInternal(KEY_EMAIL_CFG, encrypted, "email");
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Email configuration saved securely."));
    }

    [HttpGet("email-config")]
    public async Task<IActionResult> GetEmailConfig()
    {
        var enc = await GetSettingValue(KEY_EMAIL_CFG);
        if (string.IsNullOrEmpty(enc))
            return Ok(ApiResponseDto<object>.Ok(new { configured = false }));
        try
        {
            var json = _protector.Unprotect(enc);
            var cfg  = System.Text.Json.JsonSerializer.Deserialize<EmailConfigDto>(json);
            // Return config but mask all sensitive fields
            return Ok(ApiResponseDto<object>.Ok(new
            {
                configured  = true,
                provider    = cfg!.Provider,
                fromEmail   = cfg.FromEmail,
                name        = cfg.Name,
                cc          = cfg.Cc,
                // Sensitive fields: return only whether they are set, not the values
                hasApiKey   = !string.IsNullOrEmpty(cfg.ApiKey),
                hasSmtpPass = !string.IsNullOrEmpty(cfg.SmtpPass),
                smtpUser    = cfg.SmtpUser  // not secret — just email address
            }));
        }
        catch { return Ok(ApiResponseDto<object>.Ok(new { configured = false })); }
    }

    [HttpDelete("email-config")]
    public async Task<IActionResult> ClearEmailConfig()
    {
        var s = await _db.AppSettings.FirstOrDefaultAsync(x => x.Key == KEY_EMAIL_CFG);
        if (s != null) { s.IsDeleted = true; s.UpdatedAt = DateTime.UtcNow; }
        await _db.SaveChangesAsync();
        return Ok(ApiResponseDto<bool>.Ok(true, "Email configuration cleared."));
    }


    private async Task<string?> GetSettingValue(string key)
    {
        var s = await _db.AppSettings.FirstOrDefaultAsync(x => x.Key == key);
        return s?.Value;
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

    [HttpGet("{key}")]
    public async Task<IActionResult> Get(string key)
    {
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

public class EmailConfigDto {
    public string Provider    { get; set; } = string.Empty;
    public string FromEmail   { get; set; } = string.Empty;
    public string Name        { get; set; } = string.Empty;
    public string Cc          { get; set; } = string.Empty;
    public string ReplyTo     { get; set; } = string.Empty;
    public string Signature   { get; set; } = string.Empty;
    // Sensitive — encrypted in storage, never returned in GET response
    public string ApiKey      { get; set; } = string.Empty;
    public string SmtpUser    { get; set; } = string.Empty;
    public string SmtpPass    { get; set; } = string.Empty;
    public string EjsService  { get; set; } = string.Empty;
    public string EjsTemplate { get; set; } = string.Empty;
    public string EjsPubKey   { get; set; } = string.Empty;
}
