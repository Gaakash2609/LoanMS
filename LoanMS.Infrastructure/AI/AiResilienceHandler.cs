using System.Net;
using Microsoft.Extensions.Logging;

namespace LoanMS.Infrastructure.AI;

/// <summary>
/// Lightweight resilience for the "ai" HttpClient: retry with exponential
/// backoff + jitter on transient (5xx) failures, a simple circuit breaker,
/// and per-attempt latency logging. Avoids adding external resilience
/// packages.
///
/// TIMEOUT STRATEGY — adaptive, no separate/guessed per-attempt cap:
/// Earlier versions of this handler imposed their own fixed per-attempt
/// timeout (first 4s, later a single guessed 27s value). Both were wrong for
/// the same underlying reason: real Gemini Vision requests are multimodal
/// (image analysis) and have been observed taking anywhere from ~4s to ~29s
/// to genuinely succeed — any fixed sub-timeout shorter than the caller's
/// overall deadline risks cutting off a request that would have succeeded,
/// and any fixed sub-timeout is just a second guess sitting on top of the
/// real deadline that already exists one layer up (KycController's 30s
/// CancellationTokenSource).
///
/// This handler no longer creates its own timeout token. Every attempt —
/// whether it's a retry within this handler, or a different Gemini model
/// being tried by GeminiAIProvider's fallback loop one level up — runs
/// directly against the SAME shared cancellationToken that already carries
/// the caller's real deadline. Whatever time remains in that shared budget
/// is what the next attempt gets; nothing is ever cut short before that
/// shared deadline actually fires. That is what "adaptive" means here: the
/// available time adapts to what's left, computed implicitly by the single
/// existing token, instead of being guessed and hardcoded in a second place.
/// </summary>
public sealed class AiResilienceHandler : DelegatingHandler
{
    private readonly ILogger<AiResilienceHandler> _logger;

    // Retries only apply to fast, transient 5xx responses (a real response
    // came back quickly, just not a usable one) — never to "ran out of
    // time," since running out of time now means the shared deadline itself
    // fired, which this handler propagates immediately rather than retrying.
    // Raised from the earlier 0 back to a real retry count now that retries
    // can no longer waste budget on artificially-short sub-timeouts.
    private const int MaxRetries = 2;

    // Circuit breaker state (process-wide for the "ai" client).
    private const int FailureThreshold = 5;
    private static readonly TimeSpan BreakDuration = TimeSpan.FromSeconds(15);
    private static int _consecutiveFailures;
    private static long _openedUntilTicks; // DateTime.UtcNow.Ticks; 0 == closed

    public AiResilienceHandler(ILogger<AiResilienceHandler> logger) => _logger = logger;

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var openedUntil = Interlocked.Read(ref _openedUntilTicks);
        if (openedUntil != 0 && DateTime.UtcNow.Ticks < openedUntil)
            throw new HttpRequestException("AI provider circuit is open.", null, HttpStatusCode.ServiceUnavailable);

        Exception? last = null;
        for (var attempt = 1; attempt <= MaxRetries + 1; attempt++)
        {
            // If the caller's overall deadline has already fired, stop here —
            // do not start another attempt or another round of backoff.
            cancellationToken.ThrowIfCancellationRequested();

            var attemptSw = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                // No separate per-attempt timeout constructed here — this
                // attempt runs against the caller's own shared token, so it
                // naturally gets however much of the overall budget remains.
                var resp = await base.SendAsync(request, cancellationToken);
                attemptSw.Stop();

                // LATENCY_SAMPLE: structured, greppable line for building a
                // real latency distribution from actual production traffic.
                // Every attempt is logged (success, transient, or error) so a
                // genuine percentile analysis (P50/P95/etc.) can be run later
                // instead of guessing a timeout value from a handful of
                // historical examples.
                _logger.LogInformation("LATENCY_SAMPLE outcome={Outcome} status={Status} attempt={Attempt} ms={Ms}",
                    IsTransient(resp.StatusCode) ? "transient" : "success", (int)resp.StatusCode, attempt, attemptSw.ElapsedMilliseconds);

                if (IsTransient(resp.StatusCode) && attempt <= MaxRetries)
                {
                    _logger.LogWarning("AI transient status {Status}, attempt {Attempt}", (int)resp.StatusCode, attempt);
                    resp.Dispose();
                    await BackoffAsync(attempt, cancellationToken);
                    continue;
                }
                OnSuccess();
                return resp;
            }
            catch (OperationCanceledException)
            {
                // The shared deadline fired (or the client disconnected —
                // KycController holds two separate tokens and distinguishes
                // which one it was; this handler only sees the single linked
                // token it was given, so it just stops and propagates rather
                // than guessing which case applies).
                _logger.LogInformation("LATENCY_SAMPLE outcome=cancelled status=0 attempt={Attempt} ms={Ms}",
                    attempt, attemptSw.ElapsedMilliseconds);
                throw;
            }
            catch (HttpRequestException ex)
            {
                attemptSw.Stop();
                last = ex;
                _logger.LogInformation("LATENCY_SAMPLE outcome=network_error status=0 attempt={Attempt} ms={Ms}",
                    attempt, attemptSw.ElapsedMilliseconds);
                _logger.LogWarning(ex, "AI request network error, attempt {Attempt}", attempt);
            }

            if (attempt <= MaxRetries) await BackoffAsync(attempt, cancellationToken);
        }

        OnFailure();
        throw last ?? new HttpRequestException("AI request failed.", null, HttpStatusCode.ServiceUnavailable);
    }

    private static bool IsTransient(HttpStatusCode s) =>
        (int)s >= 500; // 429 handled by provider-level model fallback — do NOT retry here

    private void OnSuccess() { Interlocked.Exchange(ref _consecutiveFailures, 0); Interlocked.Exchange(ref _openedUntilTicks, 0); }

    private void OnFailure()
    {
        if (Interlocked.Increment(ref _consecutiveFailures) >= FailureThreshold)
        {
            Interlocked.Exchange(ref _openedUntilTicks, DateTime.UtcNow.Add(BreakDuration).Ticks);
            _logger.LogError("AI provider circuit opened for {Seconds}s", BreakDuration.TotalSeconds);
        }
    }

    private static async Task BackoffAsync(int attempt, CancellationToken ct)
    {
        var ms = 500 * (int)Math.Pow(2, attempt - 1) + Random.Shared.Next(0, 250);
        try { await Task.Delay(ms, ct); } catch (TaskCanceledException) { }
    }
}
