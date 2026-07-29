using LoanMS.Application.AI;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace LoanMS.Infrastructure.AI;

/// <summary>
/// OpenAI provider with retry + timeout.
/// Model: gpt-4o-mini (fast, cheap, capable)
/// </summary>
public class OpenAIProvider : IAIProvider
{
    private readonly HttpClient              _http;
    private readonly IAiKeyStore             _keyStore;
    private readonly ILogger<OpenAIProvider> _logger;
    private const int MaxRetries = 2;
    private const string VisionModel = "gpt-4o-mini";

    public string ProviderName => "openai";

    // Vision extraction is used as the automatic fallback for the same KYC
    // extraction pipeline Gemini serves — see FailoverAIProvider.
    public bool SupportsVision => true;

    public OpenAIProvider(IHttpClientFactory httpFactory, IAiKeyStore keyStore, ILogger<OpenAIProvider> logger)
    {
        _http     = httpFactory.CreateClient("ai");
        _keyStore = keyStore;
        _logger   = logger;
    }

    // Resolves the Admin-saved key from the database first (Settings → AI
    // Provider Keys), falling back to AI:OpenAIApiKey in appsettings/env —
    // see AiKeyStore. Gemini's key is intentionally never used as a fallback
    // here — different service/format, would just turn a clean
    // "OpenAI not configured" into a confusing 401.
    private Task<string?> GetApiKeyAsync() => _keyStore.GetKeyAsync("openai");

    public async Task<bool> IsAvailableAsync() => !string.IsNullOrEmpty(await GetApiKeyAsync());

    public async Task<string> CompleteAsync(string systemPrompt, string userPrompt, int maxTokens = 500)
    {
        var apiKey = await GetApiKeyAsync();
        if (string.IsNullOrEmpty(apiKey))
            throw new InvalidOperationException("OpenAI API key not configured. Set AI:OpenAIApiKey.");

        for (int attempt = 0; attempt <= MaxRetries; attempt++)
        {
            try
            {
                var body = new
                {
                    model      = "gpt-4o-mini",
                    max_tokens = maxTokens,
                    messages   = new object[]
                    {
                        new { role = "system", content = systemPrompt },
                        new { role = "user",   content = userPrompt   }
                    }
                };

                using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions");
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

                using var cts  = new CancellationTokenSource(TimeSpan.FromSeconds(25));
                var resp = await _http.SendAsync(req, cts.Token);
                resp.EnsureSuccessStatusCode();

                var json   = await resp.Content.ReadAsStringAsync();
                var parsed = JsonDocument.Parse(json);
                return parsed.RootElement
                             .GetProperty("choices")[0]
                             .GetProperty("message")
                             .GetProperty("content")
                             .GetString() ?? string.Empty;
            }
            catch (Exception ex) when (attempt < MaxRetries)
            {
                _logger.LogWarning(ex, "OpenAI attempt {Attempt} failed", attempt + 1);
                await Task.Delay(1000 * (attempt + 1));
            }
        }

        throw new Exception("OpenAI API failed after retries.");
    }

    /// <summary>
    /// Vision extraction — same request/response shape (a single text blob back
    /// to the caller) as GeminiAIProvider.ExtractFromImagesAsync, so callers
    /// (KycController etc.) parse the result identically regardless of which
    /// provider actually served the request.
    /// </summary>
    public async Task<string> ExtractFromImagesAsync(
        IReadOnlyList<VisionImage> images, string prompt, CancellationToken cancellationToken = default)
    {
        var apiKey = await GetApiKeyAsync();
        if (string.IsNullOrEmpty(apiKey))
            throw new InvalidOperationException("OpenAI API key not configured. Set AI:OpenAIApiKey.");

        var content = new List<object>();
        foreach (var img in images)
        {
            var mime = (img.MediaType ?? string.Empty).Trim().ToLowerInvariant();
            if (mime == "image/jpg") mime = "image/jpeg";
            content.Add(new { type = "image_url", image_url = new { url = $"data:{mime};base64,{img.Data}" } });
        }
        content.Add(new { type = "text", text = prompt });

        var body = new
        {
            model      = VisionModel,
            max_tokens = 1500,
            temperature = 0.0,
            messages   = new object[] { new { role = "user", content = content.ToArray() } }
        };

        var bodyJson = JsonSerializer.Serialize(body);
        Exception? lastEx = null;

        for (int attempt = 0; attempt <= MaxRetries; attempt++)
        {
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/chat/completions")
                {
                    Content = new StringContent(bodyJson, Encoding.UTF8, "application/json")
                };
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(60));
                using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, cts.Token);
                using var resp = await _http.SendAsync(req, linked.Token);
                var json = await resp.Content.ReadAsStringAsync(cancellationToken);

                if (!resp.IsSuccessStatusCode)
                {
                    _logger.LogError("OpenAI vision error [{Status}] body={Body}", (int)resp.StatusCode, json);
                    lastEx = new HttpRequestException($"OpenAI vision request failed ({(int)resp.StatusCode}).", null, resp.StatusCode);
                    if (attempt < MaxRetries) { await Task.Delay(1000 * (attempt + 1), cancellationToken); continue; }
                    throw lastEx;
                }

                using var parsed = JsonDocument.Parse(json);
                var choices = parsed.RootElement.GetProperty("choices");
                if (choices.GetArrayLength() == 0)
                {
                    _logger.LogWarning("OpenAI vision returned no choices (possible content filter) body={Body}", json);
                    throw new HttpRequestException("OpenAI returned no result for this image (it may have been filtered).", null, System.Net.HttpStatusCode.Forbidden);
                }
                var text = choices[0]
                                  .GetProperty("message")
                                  .GetProperty("content")
                                  .GetString() ?? string.Empty;
                _logger.LogInformation("OpenAI vision success with model={Model}", VisionModel);
                return text;
            }
            catch (Exception ex) when (attempt < MaxRetries && ex is not HttpRequestException)
            {
                lastEx = ex;
                _logger.LogWarning(ex, "OpenAI vision attempt {Attempt} failed", attempt + 1);
                await Task.Delay(1000 * (attempt + 1), cancellationToken);
            }
        }

        throw lastEx ?? new HttpRequestException("OpenAI vision request failed after retries.", null, System.Net.HttpStatusCode.BadGateway);
    }
}

