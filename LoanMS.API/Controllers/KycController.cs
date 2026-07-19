using LoanMS.Application.AI;
using LoanMS.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Diagnostics;

namespace LoanMS.API.Controllers;

/// <summary>
/// KYC Vision Controller — provider-neutral document extraction.
/// The browser posts images + a prompt to /api/kyc/vision; the server forwards
/// them to the configured AI provider (Gemini/OpenAI/Claude). The API key lives
/// only in server configuration (AI:ApiKey) — never in the browser.
/// </summary>
public class KycController : BaseController
{
    // Validation limits
    private const int MaxImagesPerRequest = 4;
    private const int MaxImageBytes = 20 * 1024 * 1024; // 20 MB decoded
    private const int MaxPromptChars = 20000;

    private static readonly string[] AllowedMimeTypes =
    {
        "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"
    };

    private readonly IAIProvider? _provider;
    private readonly ILogger<KycController> _log;

    public KycController(ILogger<KycController> log, IServiceProvider sp)
    {
        _log = log;
        _provider = sp.GetService(typeof(IAIProvider)) as IAIProvider;
    }

    // ── Status (read-only) ────────────────────────────────────────────────────
    [AllowAnonymous]
    [HttpGet("vision/status")]
    public async Task<IActionResult> VisionStatus()
    {
        var configured = _provider is { SupportsVision: true } && await _provider.IsAvailableAsync();
        return Ok(new
        {
            configured,
            provider = _provider?.ProviderName ?? "none"
        });
    }

    // ── Vision Proxy — Browser → /api/kyc/vision → configured provider ─────────
    [AllowAnonymous]
    [HttpPost("vision")]
    [RequestSizeLimit(60_000_000)]
    public async Task<IActionResult> VisionProxy([FromBody] KycVisionRequestDto request, CancellationToken cancellationToken)
    {
        if (_provider is null || !_provider.SupportsVision || !await _provider.IsAvailableAsync())
        {
            return Ok(new KycVisionResponseDto
            {
                Success = false,
                Code = "NOT_CONFIGURED",
                Error = "KYC Vision is not configured on the server. Ask your administrator to enable AI and set the API key."
            });
        }

        var validation = Validate(request);
        if (validation is not null)
            return BadRequest(new KycVisionResponseDto { Success = false, Code = "INVALID_INPUT", Error = validation });

        // Audit log — no PII payloads, only metadata.
        _log.LogInformation("KYC vision request STARTED: provider={Provider} docType={DocType} images={Count}",
            _provider.ProviderName, request.DocumentType, request.Images.Count);

        var sw = Stopwatch.StartNew();
        try
        {
            var images = request.Images
                .Select(i => new VisionImage { MediaType = i.MediaType, Data = i.Data })
                .ToList();

            var text = await _provider.ExtractFromImagesAsync(images, request.Prompt, cancellationToken);
            sw.Stop();

            _log.LogInformation("KYC vision FINAL RESULT: success provider={Provider} docType={DocType} totalMs={Ms}",
                _provider.ProviderName, request.DocumentType, sw.ElapsedMilliseconds);

            return Ok(new KycVisionResponseDto
            {
                Success = true,
                Provider = _provider.ProviderName,
                Text = text,
                ProcessingTimeMs = sw.ElapsedMilliseconds
            });
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            _log.LogInformation("KYC vision request CANCELLED by client after {Ms}ms.", sw.ElapsedMilliseconds);
            return StatusCode(499, new KycVisionResponseDto { Success = false, Code = "CANCELLED", Error = "Request cancelled.", ProcessingTimeMs = sw.ElapsedMilliseconds });
        }
        catch (TaskCanceledException)
        {
            // Thrown when the underlying HttpClient's own 120s Timeout (see
            // Program.cs, the "ai" client) fires internally — this does not
            // set our own cancellationToken, so it isn't matched by the
            // client-cancel clause above. Covers the case where every
            // provider in the Gemini->OpenAI->Claude failover chain has been
            // exhausted without a response inside the shared 120s budget.
            sw.Stop();
            _log.LogWarning("KYC vision TIMEOUT TRIGGERED after {Ms}ms (HttpClient timeout) — MANUAL FALLBACK ACTIVATED. provider={Provider} docType={DocType}",
                sw.ElapsedMilliseconds, _provider.ProviderName, request.DocumentType);
            return Ok(new KycVisionResponseDto
            {
                Success = false,
                Code = "TIMEOUT",
                Error = "AI extraction is taking too long — please enter details manually.",
                ProcessingTimeMs = sw.ElapsedMilliseconds
            });
        }
        catch (TimeoutException)
        {
            // Defensive fallback only — AiResilienceHandler no longer
            // constructs its own TimeoutException (it has no separate
            // per-attempt timeout anymore; every attempt runs against this
            // method's own cancellationToken, so a real timeout now surfaces
            // as OperationCanceledException and is caught by the clause above).
            // Kept in case some other source (e.g. a misconfigured
            // HttpClient.Timeout firing independently of our tokens) ever
            // raises a raw TimeoutException — same graceful outcome either way.
            sw.Stop();
            _log.LogWarning("KYC vision TIMEOUT TRIGGERED after {Ms}ms (unexpected TimeoutException) — MANUAL FALLBACK ACTIVATED. provider={Provider} docType={DocType}",
                sw.ElapsedMilliseconds, _provider.ProviderName, request.DocumentType);
            return Ok(new KycVisionResponseDto
            {
                Success = false,
                Code = "TIMEOUT",
                Error = "AI extraction is taking too long — please enter details manually.",
                ProcessingTimeMs = sw.ElapsedMilliseconds
            });
        }
        catch (HttpRequestException ex)
        {
            sw.Stop();
            var (status, code, msg) = ex.StatusCode switch
            {
                System.Net.HttpStatusCode.TooManyRequests => (429, "RATE_LIMITED", "Provider rate limit reached. Try again shortly."),
                System.Net.HttpStatusCode.Unauthorized or System.Net.HttpStatusCode.Forbidden
                    => (503, "NOT_CONFIGURED", "Provider rejected the server credentials."),
                System.Net.HttpStatusCode.ServiceUnavailable or System.Net.HttpStatusCode.BadGateway or System.Net.HttpStatusCode.GatewayTimeout
                    => (503, "PROVIDER_UNAVAILABLE", "Provider temporarily unavailable. Try again shortly."),
                _ => (502, "PROVIDER_ERROR", "KYC vision request failed.")
            };
            _log.LogWarning(ex, "KYC vision FINAL RESULT: failed code={Code} totalMs={Ms} — MANUAL FALLBACK ACTIVATED", code, sw.ElapsedMilliseconds);
            return StatusCode(status, new KycVisionResponseDto { Success = false, Code = code, Error = msg, ProcessingTimeMs = sw.ElapsedMilliseconds });
        }
        catch (Exception ex)
        {
            sw.Stop();
            // Deliberately still HTTP 500 here, unlike the controlled failure
            // paths above (timeout/rate-limit/unavailable/cancelled, which are
            // known, anticipated categories). This is the one truly-unknown
            // catch-all, and the frontend's own fetch logic (kyc.js) already
            // handles non-200 responses identically to 200-with-success:false
            // — it checks "!response.ok || !data.success", an OR — so keeping
            // 500 here has no effect on the manual-fallback UI, while
            // preserving the 5xx signal for monitoring/alerting on genuinely
            // unexpected server errors. No internal error detail is exposed
            // in the response body; full exception detail is server-side only.
            _log.LogError(ex, "KYC vision FINAL RESULT: unexpected error totalMs={Ms} — MANUAL FALLBACK ACTIVATED", sw.ElapsedMilliseconds);
            return StatusCode(500, new KycVisionResponseDto { Success = false, Code = "UNKNOWN", Error = "An unexpected error occurred.", ProcessingTimeMs = sw.ElapsedMilliseconds });
        }
    }

    // ── Validation ─────────────────────────────────────────────────────────────
    private static string? Validate(KycVisionRequestDto r)
    {
        if (r is null) return "Request body is required.";
        if (string.IsNullOrWhiteSpace(r.Prompt)) return "Prompt is required.";
        if (r.Prompt.Length > MaxPromptChars) return "Prompt is too long.";
        if (r.Images is null || r.Images.Count == 0) return "At least one image is required.";
        if (r.Images.Count > MaxImagesPerRequest) return $"Too many images (max {MaxImagesPerRequest}).";

        foreach (var img in r.Images)
        {
            if (string.IsNullOrWhiteSpace(img.Data)) return "An image payload is empty.";
            var mime = (img.MediaType ?? string.Empty).Trim().ToLowerInvariant();
            if (!AllowedMimeTypes.Contains(mime)) return $"Unsupported image type '{img.MediaType}'.";
            if (EstimateBase64DecodedLength(img.Data) > MaxImageBytes) return $"An image exceeds {MaxImageBytes / (1024 * 1024)} MB.";
            if (!IsBase64(img.Data)) return "An image is not valid base64.";
        }
        return null;
    }

    private static int EstimateBase64DecodedLength(string b64)
    {
        if (string.IsNullOrEmpty(b64)) return 0;
        var padding = b64.EndsWith("==") ? 2 : b64.EndsWith("=") ? 1 : 0;
        return (b64.Length / 4) * 3 - padding;
    }

    private static bool IsBase64(string s)
    {
        if (string.IsNullOrEmpty(s)) return false;
        // Allow URL-safe base64 (- and _) and standard base64 (+ and /)
        // Canvas toDataURL can produce base64 without strict padding
        try { Convert.FromBase64String(s.Length % 4 == 0 ? s : s + new string('=', 4 - s.Length % 4)); return true; }
        catch { return false; }
    }
}
