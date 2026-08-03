using LoanMS.Application.AI;
using Microsoft.Extensions.Configuration;using Microsoft.Extensions.Http;using Microsoft.Extensions.Logging;
using System.Net.Http;
using System.Text;
using System.Text.Json;

namespace LoanMS.Infrastructure.AI;

/// <summary>
/// Google Gemini AI provider.
/// Enable by setting AI:Provider=gemini and AI:ApiKey in appsettings/env.
/// Uses Gemini 1.5 Flash — fast and cost-effective.
/// </summary>
public class GeminiAIProvider : IAIProvider
{
    private readonly HttpClient               _http;
    private readonly IAiKeyStore               _keyStore;
    private readonly ILogger<GeminiAIProvider> _logger;

    public string ProviderName => "gemini";

    public GeminiAIProvider(IHttpClientFactory httpFactory, IAiKeyStore keyStore, ILogger<GeminiAIProvider> logger)
    {
        _http     = httpFactory.CreateClient("ai");
        _keyStore = keyStore;
        _logger   = logger;
    }

    // Resolves the Admin-saved key from the database first (Settings → AI
    // Provider Keys), falling back to AI:ApiKey in appsettings/env — see
    // AiKeyStore. Fetched fresh (not cached in the constructor) so a key
    // rotated by an Admin takes effect on the very next request.
    private Task<string?> GetApiKeyAsync() => _keyStore.GetKeyAsync("gemini");

    public async Task<bool> IsAvailableAsync() => !string.IsNullOrEmpty(await GetApiKeyAsync());

    public bool SupportsVision => true;

    // Models to try in order (current stable first, then previous-gen + auto-updating fallback).
    // NOTE: the Gemini 1.5 family and the Gemini 2.0 Flash family were retired by Google
    // (1.5 fully shut down; 2.0 Flash / 2.0 Flash-Lite shut down 2026-06-01) and now return 404.
    // gemini-2.5-flash / gemini-2.5-flash-lite are themselves at or past their own deprecation
    // window on this endpoint (generativelanguage.googleapis.com — the Gemini Developer/AI Studio
    // API, which has a SEPARATE, earlier deprecation timeline than Vertex AI's Agent Platform).
    // gemini-3.6-flash became GA in July 2026 and is Google's current recommended stable default,
    // superseding gemini-3.5-flash (still supported, kept as first fallback). gemini-flash-latest
    // is kept as a last-resort fallback only — Google's own docs now state it "points to an
    // experimental model which will typically not be suitable for production use and come with
    // more restrictive rate limits," which is exactly why extraction was silently degrading
    // (working briefly, then hitting that tighter quota) once the models ahead of it stopped
    // responding.
    // Verified against https://ai.google.dev/api and https://ai.google.dev/gemini-api/docs/latest-model
    // (both last updated within the last week as of this check) — endpoint is still v1beta;
    // there is no v1 equivalent for generateContent (v1 only exists for the separate Interactions API).
    // Revisit periodically against https://ai.google.dev/gemini-api/docs/deprecations
    private static readonly string[] VisionModels =
    {
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-flash-latest"
    };

    public async Task<string> ExtractFromImagesAsync(
        IReadOnlyList<VisionImage> images, string prompt, CancellationToken cancellationToken = default)
    {
        var apiKey = await GetApiKeyAsync();
        if (string.IsNullOrEmpty(apiKey))
            throw new InvalidOperationException("Gemini API key not configured.");

        var parts = new List<object>(images.Count + 1);
        foreach (var img in images)
        {
            var mime = (img.MediaType ?? string.Empty).Trim().ToLowerInvariant();
            if (mime == "image/jpg") mime = "image/jpeg";
            parts.Add(new { inline_data = new { mime_type = mime, data = img.Data } });
        }
        parts.Add(new { text = prompt });

        var body = new
        {
            contents = new[] { new { parts = parts.ToArray() } },
            generationConfig = new { temperature = 0.0, maxOutputTokens = 1500 }
        };

        var bodyJson = JsonSerializer.Serialize(body);
        Exception? lastEx = null;

        foreach (var model in VisionModels)
        {
            var url = $"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
            using var req = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(bodyJson, Encoding.UTF8, "application/json")
            };
            // Authenticate via the x-goog-api-key header. This works for both classic
            // "AIza" standard keys and newer "AQ." authorization keys. Passing an "AQ."
            // key via the ?key= query parameter is rejected by Google with
            // "Expected OAuth 2 access token..." — the header is the documented method.
            req.Headers.TryAddWithoutValidation("x-goog-api-key", apiKey);

            using var resp = await _http.SendAsync(req, cancellationToken);
            var json = await resp.Content.ReadAsStringAsync(cancellationToken);

            if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
            {
                _logger.LogWarning("Gemini model {Model} not found, trying next", model);
                lastEx = new HttpRequestException($"Model {model} not found.", null, resp.StatusCode);
                continue; // try next model
            }

            if (resp.StatusCode == System.Net.HttpStatusCode.TooManyRequests)
            {
                _logger.LogWarning("Gemini model {Model} rate limited (429), trying next model", model);
                lastEx = new HttpRequestException($"Gemini vision request failed ({(int)resp.StatusCode}).", null, resp.StatusCode);
                continue; // try next model
            }

            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogError("Gemini vision error [{Status}] model={Model} body={Body}", (int)resp.StatusCode, model, json);
                lastEx = new HttpRequestException($"Gemini vision request failed ({(int)resp.StatusCode}).", null, resp.StatusCode);
                continue;
            }

            using var parsed = JsonDocument.Parse(json);
            var root = parsed.RootElement;

            // A prompt-level block (e.g. safety systems reject the request before
            // even generating a candidate) shows up here instead of "candidates".
            if (root.TryGetProperty("promptFeedback", out var pf) && pf.TryGetProperty("blockReason", out var pbr))
            {
                _logger.LogWarning("Gemini vision blocked at prompt level model={Model} reason={Reason}", model, pbr.GetString());
                lastEx = new HttpRequestException($"Gemini blocked the request ({pbr.GetString()}).", null, System.Net.HttpStatusCode.Forbidden);
                continue; // try next model — a different model may not trigger the same filter
            }

            if (root.TryGetProperty("candidates", out var cands) && cands.GetArrayLength() > 0)
            {
                var candidate = cands[0];

                // Safety-filtered candidates (very possible for ID document scans, since
                // they contain PII) have finishReason "SAFETY"/"RECITATION"/etc. and NO
                // "content" property at all — GetProperty() on a missing key throws
                // KeyNotFoundException, which no caller was catching. Check first instead.
                if (!candidate.TryGetProperty("content", out var contentEl))
                {
                    var reason = candidate.TryGetProperty("finishReason", out var fr) ? fr.GetString() : "unknown";
                    _logger.LogWarning("Gemini vision returned no content model={Model} finishReason={Reason}", model, reason);
                    lastEx = new HttpRequestException($"Gemini declined to process this image (finishReason: {reason}).", null, System.Net.HttpStatusCode.Forbidden);
                    continue; // try next model
                }

                if (contentEl.TryGetProperty("parts", out var p) && p.GetArrayLength() > 0 && p[0].TryGetProperty("text", out var t))
                {
                    _logger.LogInformation("Gemini vision success with model={Model}", model);
                    return t.GetString() ?? string.Empty;
                }
            }
            _logger.LogWarning("Gemini vision returned no text from model={Model}", model);
            return string.Empty;
        }

        throw lastEx ?? new HttpRequestException("All Gemini vision models failed.", null, System.Net.HttpStatusCode.BadGateway);
    }

    public async Task<string> CompleteAsync(string systemPrompt, string userPrompt, int maxTokens = 500)
    {
        var apiKey = await GetApiKeyAsync();
        if (string.IsNullOrEmpty(apiKey))
            throw new InvalidOperationException("Gemini API key not configured.");

        var combined = $"{systemPrompt}\n\n{userPrompt}";

        var body = new
        {
            contents = new[]
            {
                new
                {
                    parts = new[] { new { text = combined } }
                }
            },
            generationConfig = new
            {
                maxOutputTokens = maxTokens,
                temperature     = 0.4
            }
        };

        // gemini-2.0-flash was retired (shut down 2026-06-01); gemini-2.5-flash is itself at
        // risk on this endpoint's own deprecation timeline (see VisionModels comment above) —
        // using gemini-3.6-flash, Google's current GA stable default as of July 2026. This method
        // has no fallback list of its own; if this single model becomes unavailable, this call
        // will fail outright. Endpoint verified current (v1beta — no v1 equivalent exists for
        // generateContent) against https://ai.google.dev/api.
        var url = $"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";
        var req = new HttpRequestMessage(HttpMethod.Post, url);
        req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        // x-goog-api-key header — works for both "AIza" standard keys and "AQ." auth keys.
        req.Headers.TryAddWithoutValidation("x-goog-api-key", apiKey);

        var resp = await _http.SendAsync(req);
        resp.EnsureSuccessStatusCode();

        var json   = await resp.Content.ReadAsStringAsync();
        var parsed = JsonDocument.Parse(json);

        return parsed.RootElement
                     .GetProperty("candidates")[0]
                     .GetProperty("content")
                     .GetProperty("parts")[0]
                     .GetProperty("text")
                     .GetString() ?? string.Empty;
    }
}
