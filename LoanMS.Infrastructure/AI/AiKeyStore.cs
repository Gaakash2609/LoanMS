using LoanMS.Application.AI;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace LoanMS.Infrastructure.AI;

/// <summary>
/// DB-first, config-fallback resolver for AI provider API keys.
/// Admin-saved keys (Settings → AI Provider Keys) are stored encrypted in the
/// AppSettings table via the same Data Protection purpose used by
/// SettingsController, so either side can read what the other wrote.
/// </summary>
public class AiKeyStore : IAiKeyStore
{
    // Must match the purpose string used in SettingsController when saving these keys.
    public const string DataProtectionPurpose = "LoanMS.AiKeys.v1";

    public const string KeyGeminiEnc = "ai_gemini_api_key_enc";
    public const string KeyOpenAiEnc = "ai_openai_api_key_enc";

    private readonly AppDbContext _db;
    private readonly IDataProtector _protector;
    private readonly IConfiguration _config;
    private readonly ILogger<AiKeyStore> _logger;

    public AiKeyStore(AppDbContext db, IDataProtectionProvider dpProvider, IConfiguration config, ILogger<AiKeyStore> logger)
    {
        _db = db;
        _protector = dpProvider.CreateProtector(DataProtectionPurpose);
        _config = config;
        _logger = logger;
    }

    public async Task<string?> GetKeyAsync(string providerName)
    {
        var name = (providerName ?? string.Empty).Trim().ToLowerInvariant();
        var dbKey = name switch
        {
            "gemini" => KeyGeminiEnc,
            "openai" => KeyOpenAiEnc,
            _ => null
        };

        if (dbKey != null)
        {
            try
            {
                var row = await _db.AppSettings.AsNoTracking()
                    .FirstOrDefaultAsync(s => s.Key == dbKey && !s.IsDeleted);
                if (row != null && !string.IsNullOrEmpty(row.Value))
                    return _protector.Unprotect(row.Value);
            }
            catch (Exception ex)
            {
                // Corrupt/undecryptable row (e.g. Data Protection keys rotated) —
                // fall through to config rather than breaking AI entirely.
                _logger.LogWarning(ex, "Failed to decrypt DB-saved {Provider} AI key, falling back to config.", name);
            }
        }

        // Fallback to the historical appsettings/env value — existing deployments
        // keep working unchanged until an Admin saves a key through Settings.
        return name switch
        {
            "gemini" => _config["AI:ApiKey"],
            "openai" => _config["AI:OpenAIApiKey"],
            _ => null
        };
    }
}
