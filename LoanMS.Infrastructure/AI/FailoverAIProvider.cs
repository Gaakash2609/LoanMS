using System.Collections.Concurrent;
using LoanMS.Application.AI;
using Microsoft.Extensions.Logging;

namespace LoanMS.Infrastructure.AI;

/// <summary>
/// Composite AI provider that automatically fails over between an ordered list
/// of underlying <see cref="IAIProvider"/> implementations (e.g. Gemini primary,
/// OpenAI fallback) without any manual intervention.
///
/// How it works:
///   - Providers are tried strictly in the order supplied to the constructor.
///   - A provider that fails with a "should fail over" condition (404, 410, 429,
///     5xx, timeout, or simply being unavailable/unconfigured) is marked
///     unhealthy for a short cooldown window, and the NEXT provider in the list
///     is tried immediately for that same request — the caller never sees the
///     failure as long as at least one provider succeeds.
///   - While a provider is in its cooldown window, it is skipped on subsequent
///     requests (so a struggling provider isn't hammered on every call) UNLESS
///     every provider is currently in cooldown, in which case the
///     highest-priority provider is tried anyway rather than failing outright.
///   - The very next time the higher-priority provider is tried and succeeds,
///     its cooldown is cleared immediately — this is the "automatic recovery"
///     behaviour: no restart, no manual switch, no background health-check
///     thread required.
///
/// This class contains zero business logic of its own — it only decides WHICH
/// underlying provider handles a given call. All prompts, parsing, and
/// extraction-format logic live entirely in the individual providers and in
/// the callers (AIService, KycController, etc.), completely unchanged.
///
/// Adding a further provider later (Claude, Azure OpenAI, ...) requires no
/// changes here — just include it in the list passed to the constructor.
/// </summary>
public sealed class FailoverAIProvider : IAIProvider
{
    private readonly IReadOnlyList<IAIProvider> _providers;
    private readonly ILogger<FailoverAIProvider> _logger;

    /// <summary>How long a provider is skipped after a fail-over-worthy failure.</summary>
    private static readonly TimeSpan CooldownDuration = TimeSpan.FromMinutes(2);

    /// <summary>Process-wide cooldown-until timestamp per provider name (UTC ticks; 0 = healthy).</summary>
    private static readonly ConcurrentDictionary<string, long> _cooldownUntilTicks = new();

    public FailoverAIProvider(IReadOnlyList<IAIProvider> providers, ILogger<FailoverAIProvider> logger)
    {
        if (providers == null || providers.Count == 0)
            throw new ArgumentException("FailoverAIProvider requires at least one underlying provider.", nameof(providers));
        _providers = providers;
        _logger    = logger;
    }

    /// <summary>Reports the highest-priority provider that is currently considered healthy.</summary>
    public string ProviderName
    {
        get
        {
            foreach (var p in _providers)
                if (!IsInCooldown(p.ProviderName)) return p.ProviderName;
            return _providers[0].ProviderName; // all in cooldown — report primary
        }
    }

    public bool SupportsVision => _providers.Any(p => p.SupportsVision);

    public async Task<bool> IsAvailableAsync()
    {
        foreach (var p in _providers)
        {
            try { if (await p.IsAvailableAsync()) return true; }
            catch { /* treat as unavailable, keep checking the rest */ }
        }
        return false;
    }

    public Task<string> CompleteAsync(string systemPrompt, string userPrompt, int maxTokens = 500) =>
        ExecuteWithFailoverAsync(
            p => p.CompleteAsync(systemPrompt, userPrompt, maxTokens),
            requireVision: false);

    public Task<string> ExtractFromImagesAsync(
        IReadOnlyList<VisionImage> images, string prompt, CancellationToken cancellationToken = default) =>
        ExecuteWithFailoverAsync(
            p => p.ExtractFromImagesAsync(images, prompt, cancellationToken),
            requireVision: true);

    // ── Core failover algorithm — shared by CompleteAsync and ExtractFromImagesAsync ──
    private async Task<string> ExecuteWithFailoverAsync(Func<IAIProvider, Task<string>> call, bool requireVision)
    {
        var candidates = requireVision ? _providers.Where(p => p.SupportsVision).ToList() : _providers.ToList();
        if (candidates.Count == 0)
            throw new NotSupportedException("No configured AI provider supports vision extraction.");

        // Try healthy providers first (in priority order), then — only if every
        // single one is currently in cooldown — fall back to trying the
        // highest-priority provider anyway rather than giving up outright.
        var ordered = candidates.OrderBy(p => IsInCooldown(p.ProviderName) ? 1 : 0).ToList();

        Exception? lastEx = null;
        foreach (var provider in ordered)
        {
            try
            {
                var result = await call(provider);
                MarkHealthy(provider.ProviderName);
                _logger.LogInformation("AI request handled by provider '{Provider}'.", provider.ProviderName);
                return result;
            }
            catch (Exception ex)
            {
                lastEx = ex;
                if (ShouldFailOver(ex))
                {
                    MarkUnhealthy(provider.ProviderName);
                    _logger.LogWarning(ex,
                        "Provider '{Provider}' failed ({Reason}) — automatically failing over to the next available provider.",
                        provider.ProviderName, DescribeFailure(ex));
                    continue;
                }
                // An exception that isn't one of the recognised fail-over conditions —
                // still try the remaining providers rather than surface it immediately,
                // since a working fallback is strictly better than failing the request.
                MarkUnhealthy(provider.ProviderName);
                _logger.LogWarning(ex,
                    "Provider '{Provider}' failed with an unrecognised error — trying next provider anyway.",
                    provider.ProviderName);
            }
        }

        _logger.LogError(lastEx, "All configured AI providers failed for this request.");
        throw lastEx ?? new InvalidOperationException("No AI provider was able to handle this request.");
    }

    /// <summary>
    /// Matches the failure conditions called out for automatic fail-over:
    /// 404, 410, 429, 5xx, timeout, or the provider being unavailable/unconfigured.
    /// </summary>
    private static bool ShouldFailOver(Exception ex) => ex switch
    {
        HttpRequestException { StatusCode: { } code } =>
            code is System.Net.HttpStatusCode.NotFound            // 404 — model deprecated/retired
                 or System.Net.HttpStatusCode.Gone                // 410 — permanently removed
                 or System.Net.HttpStatusCode.TooManyRequests     // 429 — rate limited
                 or System.Net.HttpStatusCode.ServiceUnavailable  // 5xx family + circuit-open
                 or System.Net.HttpStatusCode.InternalServerError
                 or System.Net.HttpStatusCode.BadGateway
                 or System.Net.HttpStatusCode.GatewayTimeout,
        HttpRequestException => true,                              // network error, no status code
        TimeoutException => true,
        TaskCanceledException => true,
        OperationCanceledException => true,
        InvalidOperationException => true,                         // e.g. "API key not configured"
        NotSupportedException => true,                             // provider can't do this call at all
        _ => false
    };

    private static string DescribeFailure(Exception ex) => ex switch
    {
        HttpRequestException { StatusCode: System.Net.HttpStatusCode.NotFound } => "404 model not found / deprecated",
        HttpRequestException { StatusCode: System.Net.HttpStatusCode.Gone } => "410 gone",
        HttpRequestException { StatusCode: System.Net.HttpStatusCode.TooManyRequests } => "429 rate limited",
        HttpRequestException { StatusCode: { } code } when (int)code >= 500 => $"{(int)code} server error",
        HttpRequestException => "network error",
        TimeoutException or TaskCanceledException or OperationCanceledException => "timeout",
        InvalidOperationException => "provider unavailable/unconfigured",
        NotSupportedException => "operation not supported by this provider",
        _ => ex.GetType().Name
    };

    private static bool IsInCooldown(string providerName)
    {
        if (!_cooldownUntilTicks.TryGetValue(providerName, out var until) || until == 0) return false;
        return DateTime.UtcNow.Ticks < until;
    }

    private static void MarkUnhealthy(string providerName) =>
        _cooldownUntilTicks[providerName] = DateTime.UtcNow.Add(CooldownDuration).Ticks;

    private static void MarkHealthy(string providerName) =>
        _cooldownUntilTicks[providerName] = 0;
}
