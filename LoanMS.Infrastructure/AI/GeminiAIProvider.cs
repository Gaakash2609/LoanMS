using LoanMS.Application.AI;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
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
    private readonly string?                  _apiKey;
    private readonly ILogger<GeminiAIProvider> _logger;

    public string ProviderName => "gemini";

    public GeminiAIProvider(IHttpClientFactory httpFactory, IConfiguration config, ILogger<GeminiAIProvider> logger)
    {
        _http   = httpFactory.CreateClient("ai");
        _apiKey = config["AI:ApiKey"];
        _logger = logger;
    }

    public async Task<bool> IsAvailableAsync() => !string.IsNullOrEmpty(_apiKey);

    public bool SupportsVision => true;

    // Models to try in order (current stable first, then cost-efficient + auto-updating fallback).
    // NOTE: the Gemini 1.5 family and the Gemini 2.0 Flash family were retired by Google
    // (1.5 fully shut down; 2.0 Flash / 2.0 Flash-Lite shut down 2026-06-01) and now return 404.
    // gemini-2.5-flash / gemini-2.5-flash-lite are themselves at or past their own deprecation
    // window on this endpoint (generativelanguage.googleapis.com — the Gemini Developer/AI Studio
    // API, which has a SEPARATE, earlier deprecation timeline than Vertex AI's Agent Platform).
    // gemini-3.5-flash is the current GA replacement. gemini-flash-latest is kept as a last-resort
    // fallback only — Google's own docs now state it "points to an experimental model which will
    // typically not be suitable for production use and come with more restrictive rate limits,"
    // which is exactly why extraction was silently degrading (working briefly, then hitting that
    // tighter quota) once the models ahead of it stopped responding.
    // Revisit periodically against https://ai.google.dev/gemini-api/docs/deprecations
    private static readonly string[] VisionModels =
    {
        "gemini-3.5-flash",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-flash-latest"
    };

    public async Task<string> ExtractFromImagesAsync(
        IReadOnlyList<VisionImage> images, string prompt, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_apiKey))
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
            req.Headers.TryAddWithoutValidation("x-goog-api-key", _apiKey);

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
            if (root.TryGetProperty("candidates", out var cands) && cands.GetArrayLength() > 0)
            {
                var p = cands[0].GetProperty("content").GetProperty("parts");
                if (p.GetArrayLength() > 0 && p[0].TryGetProperty("text", out var t))
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
        if (string.IsNullOrEmpty(_apiKey))
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
        // using the current GA model. This method has no fallback list of its own; if this
        // single model becomes unavailable, this call will fail outright.
        var url = $"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent";
        var req = new HttpRequestMessage(HttpMethod.Post, url);
        req.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        // x-goog-api-key header — works for both "AIza" standard keys and "AQ." auth keys.
        req.Headers.TryAddWithoutValidation("x-goog-api-key", _apiKey);

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
