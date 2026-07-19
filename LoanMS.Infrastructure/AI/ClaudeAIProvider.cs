using LoanMS.Application.AI;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace LoanMS.Infrastructure.AI;

/// <summary>
/// Claude (Anthropic) AI provider with retry + timeout handling.
/// Provider: claude | Model: claude-haiku-4-5-20251001 (fast, cost-effective)
/// </summary>
public class ClaudeAIProvider : IAIProvider
{
    private readonly HttpClient               _http;
    private readonly string?                  _apiKey;
    private readonly ILogger<ClaudeAIProvider> _logger;
    private const int MaxRetries = 2;
    private const string VisionModel = "claude-haiku-4-5-20251001";

    public string ProviderName => "claude";

    // Vision extraction is used as the third automatic fallback step for the
    // same KYC extraction pipeline Gemini/OpenAI serve — see FailoverAIProvider.
    public bool SupportsVision => true;

    public ClaudeAIProvider(IHttpClientFactory httpFactory, IConfiguration config, ILogger<ClaudeAIProvider> logger)
    {
        _http   = httpFactory.CreateClient("ai");
        // Prefer a dedicated Claude key when this provider is used inside the
        // Gemini→OpenAI→Claude failover chain (AI:ApiKey there holds Gemini's
        // key, a different service/format that would never authenticate
        // against Anthropic's API). Falls back to AI:ApiKey unchanged so the
        // existing AI:Provider=claude (standalone) case behaves exactly as
        // before when AI:ClaudeApiKey isn't set.
        _apiKey = config["AI:ClaudeApiKey"] ?? config["AI:ApiKey"];
        _logger = logger;
    }

    public Task<bool> IsAvailableAsync() => Task.FromResult(!string.IsNullOrEmpty(_apiKey));

    public async Task<string> CompleteAsync(string systemPrompt, string userPrompt, int maxTokens = 500)
    {
        if (string.IsNullOrEmpty(_apiKey))
            throw new InvalidOperationException("Claude API key not configured. Set AI:ApiKey.");

        for (int attempt = 0; attempt <= MaxRetries; attempt++)
        {
            try
            {
                var body = new
                {
                    model      = "claude-haiku-4-5-20251001",
                    max_tokens = maxTokens,
                    system     = systemPrompt,
                    messages   = new[] { new { role = "user", content = userPrompt } }
                };

                using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages");
                req.Headers.Add("x-api-key", _apiKey);
                req.Headers.Add("anthropic-version", "2023-06-01");
                req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

                using var cts  = new CancellationTokenSource(TimeSpan.FromSeconds(25));
                var resp = await _http.SendAsync(req, cts.Token);
                resp.EnsureSuccessStatusCode();

                var json   = await resp.Content.ReadAsStringAsync();
                var parsed = JsonDocument.Parse(json);
                return parsed.RootElement
                             .GetProperty("content")[0]
                             .GetProperty("text")
                             .GetString() ?? string.Empty;
            }
            catch (Exception ex) when (attempt < MaxRetries)
            {
                _logger.LogWarning(ex, "Claude API attempt {Attempt} failed: {Message}", attempt + 1, ex.Message);
                await Task.Delay(1000 * (attempt + 1));
            }
        }

        throw new Exception("Claude API failed after retries.");
    }

    /// <summary>
    /// Vision extraction — same request/response shape (a single text blob
    /// back to the caller) as GeminiAIProvider/OpenAIProvider.ExtractFromImagesAsync,
    /// so callers (KycController etc.) parse the result identically regardless
    /// of which provider actually served the request.
    /// </summary>
    public async Task<string> ExtractFromImagesAsync(
        IReadOnlyList<VisionImage> images, string prompt, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_apiKey))
            throw new InvalidOperationException("Claude API key not configured. Set AI:ClaudeApiKey or AI:ApiKey.");

        var content = new List<object>();
        foreach (var img in images)
        {
            var mime = (img.MediaType ?? string.Empty).Trim().ToLowerInvariant();
            if (mime == "image/jpg") mime = "image/jpeg";
            content.Add(new { type = "image", source = new { type = "base64", media_type = mime, data = img.Data } });
        }
        content.Add(new { type = "text", text = prompt });

        var body = new
        {
            model      = VisionModel,
            max_tokens = 1500,
            messages   = new object[] { new { role = "user", content = content.ToArray() } }
        };

        var bodyJson = JsonSerializer.Serialize(body);
        Exception? lastEx = null;

        for (int attempt = 0; attempt <= MaxRetries; attempt++)
        {
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages")
                {
                    Content = new StringContent(bodyJson, Encoding.UTF8, "application/json")
                };
                req.Headers.Add("x-api-key", _apiKey);
                req.Headers.Add("anthropic-version", "2023-06-01");

                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
                using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, cts.Token);
                using var resp = await _http.SendAsync(req, linked.Token);
                var json = await resp.Content.ReadAsStringAsync(cancellationToken);

                if (!resp.IsSuccessStatusCode)
                {
                    _logger.LogError("Claude vision error [{Status}] body={Body}", (int)resp.StatusCode, json);
                    lastEx = new HttpRequestException($"Claude vision request failed ({(int)resp.StatusCode}).", null, resp.StatusCode);
                    if (attempt < MaxRetries) { await Task.Delay(1000 * (attempt + 1), cancellationToken); continue; }
                    throw lastEx;
                }

                using var parsed = JsonDocument.Parse(json);
                var text = parsed.RootElement
                                  .GetProperty("content")[0]
                                  .GetProperty("text")
                                  .GetString() ?? string.Empty;
                _logger.LogInformation("Claude vision success with model={Model}", VisionModel);
                return text;
            }
            catch (Exception ex) when (attempt < MaxRetries && ex is not HttpRequestException)
            {
                lastEx = ex;
                _logger.LogWarning(ex, "Claude vision attempt {Attempt} failed", attempt + 1);
                await Task.Delay(1000 * (attempt + 1), cancellationToken);
            }
        }

        throw lastEx ?? new HttpRequestException("Claude vision request failed after retries.", null, System.Net.HttpStatusCode.BadGateway);
    }
}
