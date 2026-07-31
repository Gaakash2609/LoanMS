using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LoanMS.API.Controllers;

/// <summary>
/// InCred API Proxy Controller — mirrors incred_mixin.py exactly.
/// Credentials: read from DB (encrypted), configured via Settings.
/// </summary>
// PHASE 6 SECURITY FIX (two issues found in the same controller):
//  1) This controller was [AllowAnonymous] at the class level, with the
//     comment that it's "secured by InCred's own OAuth2 (client_credentials)".
//     That reasoning only covers InCred's side — it does not stop an anonymous
//     internet caller from hitting LoanMS's own proxy endpoints (application
//     init, offer request/status, loan creation, document upload, disbursement
//     lookup, ...) using LoanMS's own stored InCred credentials, with zero
//     LoanMS-side authentication. Changed to [Authorize] so only logged-in
//     LoanMS users can invoke it, consistent with every other business
//     controller in this API.
//  2) The class previously carried hardcoded, real-looking InCred
//     client_id/client_secret constants as a "built-in fallback" so the app
//     "works on fresh install without Settings configuration". A secret
//     committed to source control is a leaked credential regardless of who
//     can currently see the repo, and should be rotated with InCred and
//     stored only in AppSettings from now on. The hardcoded fallback has been
//     removed; _loadCreds() below now throws if InCred is not configured in
//     Settings, the same fail-closed pattern already used for Jwt:Key in
//     Program.cs, instead of silently operating with a shipped secret.
[Authorize]
public class IncredController : BaseController
{
    private const string KEY_BASE_URL      = "incred_base_url";
    private const string KEY_CLIENT_ID     = "incred_client_id";
    private const string KEY_CLIENT_SECRET = "incred_client_secret_enc";

    private readonly AppDbContext _db;
    private readonly IHttpClientFactory _http;
    private readonly IDataProtector _protector;
    private readonly ILogger<IncredController> _log;
    private readonly ICacheService _cache;

    public IncredController(AppDbContext db, IHttpClientFactory http,
        IDataProtectionProvider dpProvider, ILogger<IncredController> log, ICacheService cache)
    {
        _db = db;
        _http = http;
        _protector = dpProvider.CreateProtector("LoanMS.InCredSecrets.v1");
        _log = log;
        _cache = cache;
    }

    // ── Load credentials from DB (Settings); no built-in fallback — see PHASE 6 fix ──
    private async Task<(string baseUrl, string clientId, string clientSecret)> _loadCreds()
    {
        var baseUrl   = await _db.AppSettings
            .Where(s => s.Key == KEY_BASE_URL && !s.IsDeleted)
            .Select(s => s.Value).FirstOrDefaultAsync();
        var clientId  = await _db.AppSettings
            .Where(s => s.Key == KEY_CLIENT_ID && !s.IsDeleted)
            .Select(s => s.Value).FirstOrDefaultAsync();
        var encSecret = await _db.AppSettings
            .Where(s => s.Key == KEY_CLIENT_SECRET && !s.IsDeleted)
            .Select(s => s.Value).FirstOrDefaultAsync();

        // If DB has full config, use it (with decryption)
        if (!string.IsNullOrEmpty(baseUrl) &&
            !string.IsNullOrEmpty(clientId) &&
            !string.IsNullOrEmpty(encSecret))
        {
            try
            {
                var secret = _protector.Unprotect(encSecret);
                return (baseUrl, clientId, secret);
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Failed to decrypt InCred secret from DB — treating InCred as unconfigured");
            }
        }

        // PHASE 6 SECURITY FIX: previously fell back to hardcoded, committed
        // InCred credentials here. That fallback has been removed — InCred
        // access must now be configured via Settings (incred_base_url,
        // incred_client_id, incred_client_secret_enc). Fail closed instead of
        // silently operating with a shipped secret, matching how Program.cs
        // already refuses to start without a configured Jwt:Key.
        _log.LogError("InCred credentials are not configured in Settings.");
        throw new InvalidOperationException(
            "InCred is not configured. Set incred_base_url, incred_client_id, and " +
            "incred_client_secret_enc in Settings before using InCred integration endpoints.");
    }

    // ── Token caching (Item 4) ──────────────────────────────────────────────
    // Small record cached via the app's existing ICacheService abstraction
    // (same one LoanService/CustomerService already use) — no new caching
    // mechanism introduced. Only the access token + its computed expiry are
    // cached; the client_secret is never written to cache or logs.
    // internal (not private): lets LoanMS.Tests construct an already-expired token
    // to precisely test the expiry-refresh path, instead of waiting on real time.
    internal sealed class CachedIncredToken
    {
        public string AccessToken { get; set; } = "";
        public DateTime ExpiresAtUtc { get; set; }
    }

    // Single-flight lock: must be static because MVC creates a new
    // IncredController instance per request, so an instance field would give
    // every concurrent request its own lock (no actual protection). This
    // prevents N concurrent requests from all firing their own InCred token
    // request when the cache is cold/expired.
    private static readonly SemaphoreSlim _tokenRefreshLock = new(1, 1);
    private static readonly Random _retryJitterRng = new();
    internal const string TOKEN_CACHE_KEY_PREFIX = "incred:oauth-token:";

    // ── Cached token accessor. Respects InCred's expires_in, refreshes ~60s
    // before actual expiry, and de-duplicates concurrent refreshes. Does NOT
    // change _loadCreds()/fallback behavior — it only wraps the token step.
    private async Task<string?> _getTokenCached(
        (string baseUrl, string clientId, string clientSecret) creds,
        CancellationToken ct,
        bool forceRefresh = false)
    {
        var cacheKey = TOKEN_CACHE_KEY_PREFIX + creds.clientId;

        if (!forceRefresh)
        {
            var cached = await _cache.GetAsync<CachedIncredToken>(cacheKey);
            if (cached != null && cached.ExpiresAtUtc > DateTime.UtcNow)
                return cached.AccessToken;
        }

        await _tokenRefreshLock.WaitAsync(ct);
        try
        {
            // Re-check after acquiring the lock — another request may have
            // already refreshed the token while this one was waiting.
            if (!forceRefresh)
            {
                var cached = await _cache.GetAsync<CachedIncredToken>(cacheKey);
                if (cached != null && cached.ExpiresAtUtc > DateTime.UtcNow)
                    return cached.AccessToken;
            }

            var (token, expiresIn) = await _fetchTokenFromIncred(creds, ct);
            if (token == null)
                return null;

            var ttlSeconds = Math.Max(30, expiresIn - 60); // refresh ~60s early
            await _cache.SetAsync(cacheKey,
                new CachedIncredToken { AccessToken = token, ExpiresAtUtc = DateTime.UtcNow.AddSeconds(expiresIn) },
                TimeSpan.FromSeconds(ttlSeconds));
            return token;
        }
        finally
        {
            _tokenRefreshLock.Release();
        }
    }

    // ── Raw token fetch from InCred (mirrors incred_get_token). Safe to retry
    // on transient failures (timeout/429/5xx) — a token request has no side
    // effects on InCred's side, unlike application/init. Returns expires_in
    // from InCred's response, defaulting to 3600s (standard OAuth2
    // client_credentials default) only if the field is absent.
    private async Task<(string? token, int expiresIn)> _fetchTokenFromIncred(
        (string baseUrl, string clientId, string clientSecret) creds, CancellationToken ct)
    {
        const int maxAttempts = 3;
        for (int attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                var client = _http.CreateClient("incred");
                var form   = new FormUrlEncodedContent(new Dictionary<string, string>
                {
                    ["grant_type"]    = "client_credentials",
                    ["client_id"]     = creds.clientId,
                    ["client_secret"] = creds.clientSecret,
                });

                var resp = await client.PostAsync(
                    $"{creds.baseUrl}/auth/incred/protocol/openid-connect/token", form, ct);

                if (!resp.IsSuccessStatusCode)
                {
                    var errBody = await resp.Content.ReadAsStringAsync(ct);
                    _log.LogError("InCred token HTTP {Status}: {Body}", resp.StatusCode, errBody[..Math.Min(errBody.Length, 200)]);

                    var isTransient = (int)resp.StatusCode == 429 || (int)resp.StatusCode >= 500;
                    if (isTransient && attempt < maxAttempts)
                    {
                        _log.LogWarning("InCred token fetch transient HTTP {Status} (attempt {Attempt}/{Max}) — retrying",
                            resp.StatusCode, attempt, maxAttempts);
                        await _backoffDelayAsync(attempt, ct);
                        continue;
                    }
                    return (null, 0);
                }

                var json = await resp.Content.ReadAsStringAsync(ct);
                var doc  = JsonDocument.Parse(json);
                var tok  = doc.RootElement.TryGetProperty("access_token", out var t) ? t.GetString() : null;
                var expiresIn = doc.RootElement.TryGetProperty("expires_in", out var ei) && ei.TryGetInt32(out var eiVal)
                    ? eiVal : 3600;
                if (string.IsNullOrEmpty(tok))
                {
                    _log.LogError("InCred token response had no access_token: {Json}", json[..Math.Min(json.Length, 200)]);
                    return (null, 0);
                }
                return (tok, expiresIn);
            }
            catch (Exception ex) when (attempt < maxAttempts &&
                (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested)))
            {
                _log.LogWarning(ex, "InCred token fetch transient error (attempt {Attempt}/{Max}) — retrying", attempt, maxAttempts);
                await _backoffDelayAsync(attempt, ct);
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "InCred _getToken error");
                return (null, 0);
            }
        }
        return (null, 0);
    }

    // ── Exponential backoff with jitter for transient-retry paths. 400ms,
    // 800ms, 1600ms base delays + up to 200ms jitter, so concurrent retries
    // don't all land on InCred at the exact same instant.
    private static async Task _backoffDelayAsync(int attempt, CancellationToken ct)
    {
        var baseDelayMs = 400 * Math.Pow(2, attempt - 1);
        var jitterMs = _retryJitterRng.Next(0, 200);
        try { await Task.Delay(TimeSpan.FromMilliseconds(baseDelayMs + jitterMs), ct); }
        catch (TaskCanceledException) { /* request aborted during backoff — caller's send will observe it */ }
    }

    // ── Unified InCred call executor (Items 3 + 4). Every action below routes
    // its InCred HTTP call through here so token caching and 401-refresh-retry
    // are applied consistently in one place instead of being duplicated per
    // endpoint. `allowTransientRetry` controls whether timeout/429/5xx errors
    // get retried with backoff — deliberately false for application/init (see
    // CreateApplication/CreateIncredApplicationForLoan): a timeout on that call
    // is ambiguous (InCred may have already created the application on their
    // side even though we never saw the response), so blindly retrying it could
    // create a duplicate application. offer/request and offer/status have no
    // such ambiguity risk and pass allowTransientRetry: true.
    // The 401 refresh-retry path, in contrast, is always safe to apply
    // (including for application/init): a 401 means InCred's auth layer
    // rejected the call before any business logic ran, so nothing was created
    // on their side — retrying once with a fresh token cannot cause a duplicate.
    private async Task<(int statusCode, string body)> _execIncredCallAsync(
        HttpMethod method,
        string url,
        (string baseUrl, string clientId, string clientSecret) creds,
        string? jsonBody,
        string opName,
        CancellationToken ct,
        bool allowTransientRetry = false)
    {
        var token = await _getTokenCached(creds, ct);
        if (token == null)
            throw new InvalidOperationException("Failed to get InCred token");

        var client = _http.CreateClient("incred");
        var (resp, body) = await _sendIncredRequestAsync(method, url, token, jsonBody, client, opName, ct, allowTransientRetry);

        if (resp != null && (int)resp.StatusCode == 401)
        {
            _log.LogWarning("InCred {Op} got 401 with cached token — refreshing token and retrying once", opName);
            var freshToken = await _getTokenCached(creds, ct, forceRefresh: true);
            if (freshToken == null)
                throw new InvalidOperationException("Failed to refresh InCred token after 401");
            (resp, body) = await _sendIncredRequestAsync(method, url, freshToken, jsonBody, client, opName, ct, allowTransientRetry);
        }

        if (resp == null)
            throw new InvalidOperationException($"InCred {opName} failed after retries");

        _log.LogInformation("InCred {Op} [{Status}]: {Body}", opName, resp.StatusCode, body[..Math.Min(body.Length, 300)]);
        return ((int)resp.StatusCode, body);
    }

    private async Task<(HttpResponseMessage? resp, string body)> _sendIncredRequestAsync(
        HttpMethod method, string url, string token, string? jsonBody, HttpClient client,
        string opName, CancellationToken ct, bool allowTransientRetry)
    {
        const int maxAttempts = 3;
        Exception? lastEx = null;
        var attempts = allowTransientRetry ? maxAttempts : 1;
        for (int attempt = 1; attempt <= attempts; attempt++)
        {
            try
            {
                var req  = _buildRequest(method, url, token, jsonBody);
                var resp = await client.SendAsync(req, ct);
                var isTransient = (int)resp.StatusCode == 429 || (int)resp.StatusCode >= 500;
                if (isTransient && attempt < attempts)
                {
                    _log.LogWarning("InCred {Op} transient HTTP {Status} (attempt {Attempt}/{Max}) — retrying",
                        opName, resp.StatusCode, attempt, attempts);
                    await _backoffDelayAsync(attempt, ct);
                    continue;
                }
                var body = await resp.Content.ReadAsStringAsync(ct);
                return (resp, body);
            }
            catch (Exception ex) when (attempt < attempts &&
                (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested)))
            {
                lastEx = ex;
                _log.LogWarning(ex, "InCred {Op} transient exception (attempt {Attempt}/{Max}) — retrying",
                    opName, attempt, attempts);
                await _backoffDelayAsync(attempt, ct);
            }
        }
        if (lastEx != null) throw lastEx;
        return (null, "");
    }

    // ── Helper: build HttpRequestMessage with jwt_token as REQUEST header ────
    // InCred API expects jwt_token as an HTTP REQUEST header, NOT a content header.
    // Using content.Headers.Add("jwt_token") is wrong — this sends it as a content-type header.
    private HttpRequestMessage _buildRequest(
        HttpMethod method, string url, string jwtToken, string? jsonBody = null)
    {
        var req = new HttpRequestMessage(method, url);
        req.Headers.Add("jwt_token", jwtToken);   // ← correct: REQUEST header
        if (jsonBody != null)
            req.Content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
        return req;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/incred/status — check if credentials are configured
    // ─────────────────────────────────────────────────────────────────────────
    [HttpGet("status")]
    public async Task<IActionResult> GetStatus()
    {
        var hasDbCreds = await _db.AppSettings.AnyAsync(
            s => s.Key == KEY_CLIENT_ID && !s.IsDeleted && s.Value != null);
        var creds = await _loadCreds();
        return Ok(new {
            configured     = true,   // always true — built-in fallback ensures we can always call
            usingDbCreds   = hasDbCreds,
            usingBuiltIn   = !hasDbCreds,
            baseUrl        = creds.baseUrl,
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/incred/token  (mirrors incred_get_token)
    // Intentionally bypasses the token cache below — this endpoint exists to
    // show the raw live token exchange for debugging/Settings verification,
    // so it always hits InCred directly rather than returning a cached value.
    // ─────────────────────────────────────────────────────────────────────────
    [HttpPost("token")]
    public async Task<IActionResult> GetToken()
    {
        var creds = await _loadCreds();
        var client = _http.CreateClient("incred");
        var form = new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"]    = "client_credentials",
            ["client_id"]     = creds.clientId,
            ["client_secret"] = creds.clientSecret,
        });

        try
        {
            var resp = await client.PostAsync(
                $"{creds.baseUrl}/auth/incred/protocol/openid-connect/token", form);
            var body = await resp.Content.ReadAsStringAsync();
            _log.LogInformation("InCred token [{Status}]", resp.StatusCode);
            return Content(body, "application/json");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred token error");
            return StatusCode(502, new { status = false, message = "InCred token request failed: " + ex.Message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/incred/application/init  (mirrors incred_create_application)
    // Payload: { MOBILE, FNAME, MNAME, LNAME, PAN, DOB, GENDER,
    //            EMPLOYMENT_TYPE, PARTNER_REFERENCE, EMPLOYMENT, ADDRESS,
    //            PARTNER_DATA.RM_EMAIL (optional) }
    // ─────────────────────────────────────────────────────────────────────────
    [HttpPost("application/init")]
    public async Task<IActionResult> CreateApplication([FromBody] JsonElement payload)
    {
        // payload is a struct — an empty/invalid body or a Content-Type other than
        // application/json makes model binding silently hand us a default JsonElement
        // (ValueKind == Undefined) instead of failing. Calling GetRawText() on that
        // throws InvalidOperationException, which the catch below used to mask as a
        // misleading 502 "Operation is not valid due to the current state of the
        // object." Catch it here instead and report the real problem.
        if (payload.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
            return BadRequest(new { status = false, message = "Request body is missing or is not valid JSON. Send a JSON object with Content-Type: application/json." });

        var creds = await _loadCreds();

        try
        {
            var (_, body) = await _execIncredCallAsync(
                HttpMethod.Post,
                $"{creds.baseUrl}/digital-partner/application/init",
                creds,
                payload.GetRawText(),
                "create app",
                HttpContext.RequestAborted,
                allowTransientRetry: false // never blindly retry application/init — see _execIncredCallAsync docs
            );
            return Content(body, "application/json");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred create application error");
            return StatusCode(502, new { status = false, message = ex.Message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/incred/offer/request  (mirrors incred_offer_request)
    // Payload: { APPLICATION_ID, BUREAU_CONSENT: { status:'Y', date:'ISO' } }
    // ─────────────────────────────────────────────────────────────────────────
    [HttpPost("offer/request")]
    public async Task<IActionResult> OfferRequest([FromBody] JsonElement payload)
    {
        if (payload.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
            return BadRequest(new { status = false, message = "Request body is missing or is not valid JSON. Send a JSON object with Content-Type: application/json." });

        var creds = await _loadCreds();

        try
        {
            var (_, body) = await _execIncredCallAsync(
                HttpMethod.Post,
                $"{creds.baseUrl}/digital-partner/offer/request",
                creds,
                payload.GetRawText(),
                "offer request",
                HttpContext.RequestAborted,
                allowTransientRetry: true
            );
            return Content(body, "application/json");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred offer request error");
            return StatusCode(502, new { status = false, message = ex.Message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/incred/offer/status  (mirrors incred_poll_offer)
    // Payload: { APPLICATION_ID, REQUEST_ID }
    // ─────────────────────────────────────────────────────────────────────────
    [HttpPost("offer/status")]
    public async Task<IActionResult> PollOfferStatus([FromBody] JsonElement payload)
    {
        if (payload.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
            return BadRequest(new { status = false, message = "Request body is missing or is not valid JSON. Send a JSON object with Content-Type: application/json." });

        var creds = await _loadCreds();

        try
        {
            var (_, body) = await _execIncredCallAsync(
                HttpMethod.Post,
                $"{creds.baseUrl}/digital-partner/offer/status",
                creds,
                payload.GetRawText(),
                "poll status",
                HttpContext.RequestAborted,
                allowTransientRetry: true
            );
            return Content(body, "application/json");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred poll status error");
            return StatusCode(502, new { status = false, message = ex.Message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/incred/loan/{loanId} — current stored InCred state for one loan,
    // used to render the "InCred" tab on the loan detail page without hitting
    // InCred's servers on every page load.
    // ─────────────────────────────────────────────────────────────────────────
    [HttpGet("loan/{loanId:int}")]
    public async Task<IActionResult> GetLoanIncredInfo(int loanId)
    {
        var loan = await _db.Loans.Include(l => l.IncredOffers)
            .FirstOrDefaultAsync(l => l.Id == loanId);
        if (loan == null)
            return NotFound(ApiResponseDto<IncredLoanInfoDto>.Fail("Loan not found"));

        return Ok(ApiResponseDto<IncredLoanInfoDto>.Ok(_mapIncredInfo(loan)));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/incred/loan/{loanId}/create — the "+ Create InCred App" action.
    // Runs the full onboarding chain back-to-back and persists every step on
    // the Loan row: application/init → offer/request → offer/status.
    // Mirrors incred_create_application + incred_offer_request + incred_poll_offer.
    // ─────────────────────────────────────────────────────────────────────────
    [HttpPost("loan/{loanId:int}/create")]
    public async Task<IActionResult> CreateIncredApplicationForLoan(int loanId)
    {
        // No form/request body — payload is built entirely from the loan's existing
        // Customer record (Gender, FatherName, ResidenceType are now real Customer
        // fields, captured once at KYC instead of via a one-off InCred form).
        var loan = await _db.Loans.Include(l => l.Customer).Include(l => l.IncredOffers)
            .FirstOrDefaultAsync(l => l.Id == loanId);
        if (loan == null)
            return NotFound(ApiResponseDto<IncredLoanInfoDto>.Fail("Loan not found"));

        var customer = loan.Customer;
        if (customer == null)
            return BadRequest(ApiResponseDto<IncredLoanInfoDto>.Fail("Loan has no linked customer"));

        // Idempotency guard: the React "+ Create InCred App" button already hides
        // itself once isIncredApplication is true, but that's a frontend-only
        // check — nothing stopped a double-click before the first response
        // returns, a network retry, or a direct API call from re-running
        // application/init and creating a second InCred application for the same
        // loan. If one already exists, return it as-is instead of re-creating;
        // use POST /loan/{loanId}/refresh-offer to re-poll an existing offer.
        if (loan.ApplicationSource == "incred" && !string.IsNullOrEmpty(loan.IncredApplicationId))
            return Ok(ApiResponseDto<IncredLoanInfoDto>.Ok(_mapIncredInfo(loan),
                "InCred application already exists for this loan — use Refresh to re-poll the offer."));

        // GENDER is mandatory on InCred's application/init API — and only accepts
        // exactly "M" or "F". Map from our stored Male/Female/Other and fail fast
        // with a clear message if it can't be mapped (Gender missing, or "Other",
        // which InCred's API has no value for).
        var incredGender = _mapGenderForIncred(customer.Gender);
        if (incredGender == null)
            return BadRequest(ApiResponseDto<IncredLoanInfoDto>.Fail(
                "Customer's Gender is not set to Male or Female — InCred's API only accepts M/F. Update the customer's profile before creating an InCred application."));

        // EMPLOYMENT_TYPE is also mandatory and enum-restricted (SALARIED/SELFEMP/
        // NOTEARNING) — we store the human-readable form (Salaried/Self-Employed/
        // Professional), so map it too and fail fast if it doesn't map.
        var incredEmploymentType = _mapEmploymentTypeForIncred(customer.EmploymentType);
        if (incredEmploymentType == null)
            return BadRequest(ApiResponseDto<IncredLoanInfoDto>.Fail(
                "Customer's Employment Type is missing or not recognized by InCred (expected Salaried / Self-Employed). Update the customer's profile before creating an InCred application."));

        var creds = await _loadCreds();

        // Customer only stores FullName — split for FNAME/LNAME like the reference does.
        var nameParts = (customer.FullName ?? "").Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries);
        var firstName = nameParts.Length > 0 ? nameParts[0] : "";
        var lastName  = nameParts.Length > 1 ? nameParts[^1] : "";

        var addressEntry = new Dictionary<string, object?>
        {
            ["PINCODE"] = int.TryParse(customer.PinCode, out var pin) ? pin : 0,
        };
        // RESIDENCE_TYPE is optional on InCred's side, and only accepts a fixed enum —
        // only include it when we can confidently map our own value to their enum.
        var incredResidenceType = _mapResidenceTypeForIncred(customer.ResidenceType);
        if (incredResidenceType != null)
            addressEntry["RESIDENCE_TYPE"] = incredResidenceType;

        var initPayload = new Dictionary<string, object?>
        {
            ["MOBILE"]             = customer.Phone ?? "",
            ["FNAME"]              = firstName,
            ["MNAME"]              = customer.FatherName ?? "",
            ["LNAME"]              = lastName,
            ["PAN"]                = customer.PanNumber ?? "",
            ["DOB"]                = customer.DateOfBirth?.ToString("dd/MM/yyyy") ?? "",
            ["GENDER"]             = incredGender,
            ["EMPLOYMENT_TYPE"]    = incredEmploymentType,
            ["PARTNER_REFERENCE"]  = loan.Id.ToString(),
            ["EMPLOYMENT"]         = new[] { new Dictionary<string, object?> {
                ["SALARY"] = new Dictionary<string, object?> { ["NET_MONTHLY"] = customer.MonthlyIncome ?? 0 }
            }},
            ["ADDRESS"]            = new[] { addressEntry },
        };

        var initJson = JsonSerializer.Serialize(initPayload);
        _log.LogInformation("InCred create application (loan {LoanId}) payload: {Payload}", loanId, initJson);

        JsonElement initResult;
        try
        {
            var (_, body) = await _execIncredCallAsync(
                HttpMethod.Post,
                $"{creds.baseUrl}/digital-partner/application/init",
                creds, initJson, $"create app (loan {loanId})", HttpContext.RequestAborted,
                allowTransientRetry: false // never blindly retry application/init — see _execIncredCallAsync docs
            );
            initResult = JsonDocument.Parse(body).RootElement;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred create application error (loan {LoanId})", loanId);
            loan.IncredErrorMessage = ex.Message;
            await _db.SaveChangesAsync();
            return StatusCode(502, ApiResponseDto<IncredLoanInfoDto>.Fail("InCred application creation failed: " + ex.Message));
        }

        loan.ApplicationSource = "incred";

        if (!_getBool(initResult, "status"))
        {
            var err = _getString(initResult, "message") ?? _getString(initResult, "errorCode") ?? "InCred application creation failed";
            loan.IncredErrorMessage = err;
            loan.IncredLastSyncedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return BadRequest(ApiResponseDto<IncredLoanInfoDto>.Ok(_mapIncredInfo(loan), err));
        }

        if (initResult.TryGetProperty("response", out var initResp))
        {
            loan.IncredApplicationId = _getString(initResp, "APPLICATION_ID");
            loan.IncredCustomerId    = _getString(initResp, "CUSTOMER_ID");
        }
        loan.IncredErrorMessage = null;
        loan.IncredLastSyncedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // ── Step 2: offer/request ─────────────────────────────────────────────
        var consentDate = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.000Z");
        var offerReqPayload = new Dictionary<string, object?>
        {
            ["APPLICATION_ID"] = loan.IncredApplicationId,
            ["BUREAU_CONSENT"] = new Dictionary<string, object?> { ["status"] = "Y", ["date"] = consentDate },
        };

        JsonElement offerReqResult;
        try
        {
            var (_, body) = await _execIncredCallAsync(
                HttpMethod.Post,
                $"{creds.baseUrl}/digital-partner/offer/request",
                creds, JsonSerializer.Serialize(offerReqPayload), $"offer request (loan {loanId})", HttpContext.RequestAborted,
                allowTransientRetry: true
            );
            offerReqResult = JsonDocument.Parse(body).RootElement;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred offer request error (loan {LoanId})", loanId);
            loan.IncredErrorMessage = ex.Message;
            await _db.SaveChangesAsync();
            // application was created even though the offer step failed — return partial state, not a hard error
            return Ok(ApiResponseDto<IncredLoanInfoDto>.Ok(_mapIncredInfo(loan), "Application created, but offer request failed: " + ex.Message));
        }

        if (!_getBool(offerReqResult, "status"))
        {
            var msg = _getString(offerReqResult, "message") ?? "InCred offer request failed";
            loan.IncredErrorMessage = msg;
            await _db.SaveChangesAsync();
            return Ok(ApiResponseDto<IncredLoanInfoDto>.Ok(_mapIncredInfo(loan), "Application created, but " + msg));
        }

        if (offerReqResult.TryGetProperty("response", out var offerResp))
            loan.IncredRequestId = _getString(offerResp, "REQUEST_ID");
        loan.IncredOfferStatus  = "pending";
        loan.IncredErrorMessage = null;
        loan.IncredLastSyncedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // ── Step 3: poll once immediately so pre-approved offers show up right away ──
        await _pollAndPersistOffer(loan, creds, HttpContext.RequestAborted);

        return Ok(ApiResponseDto<IncredLoanInfoDto>.Ok(_mapIncredInfo(loan), "InCred application created"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/incred/loan/{loanId}/refresh-offer — re-poll offer status
    // (mirrors incred_poll_offer) without re-creating the application. Used for
    // banking-flow offers that take longer than the initial poll to appear.
    // ─────────────────────────────────────────────────────────────────────────
    [HttpPost("loan/{loanId:int}/refresh-offer")]
    public async Task<IActionResult> RefreshOffer(int loanId)
    {
        var loan = await _db.Loans.Include(l => l.IncredOffers).FirstOrDefaultAsync(l => l.Id == loanId);
        if (loan == null)
            return NotFound(ApiResponseDto<IncredLoanInfoDto>.Fail("Loan not found"));
        if (string.IsNullOrEmpty(loan.IncredRequestId))
            return BadRequest(ApiResponseDto<IncredLoanInfoDto>.Fail("No InCred Offer Request ID found — create the application first"));

        var creds = await _loadCreds();
        await _pollAndPersistOffer(loan, creds, HttpContext.RequestAborted);
        return Ok(ApiResponseDto<IncredLoanInfoDto>.Ok(_mapIncredInfo(loan)));
    }

    // ── Poll offer/status and persist STATUS + LOAN_OFFERS onto the loan row ───
    private async Task _pollAndPersistOffer(Loan loan,
        (string baseUrl, string clientId, string clientSecret) creds, CancellationToken ct)
    {
        try
        {
            var pollPayload = new Dictionary<string, object?>
            {
                ["APPLICATION_ID"] = loan.IncredApplicationId,
                ["REQUEST_ID"]     = loan.IncredRequestId,
            };
            var (_, body) = await _execIncredCallAsync(
                HttpMethod.Post,
                $"{creds.baseUrl}/digital-partner/offer/status",
                creds, JsonSerializer.Serialize(pollPayload), $"poll status (loan {loan.Id})", ct,
                allowTransientRetry: true
            );
            var result = JsonDocument.Parse(body).RootElement;

            if (!_getBool(result, "status"))
            {
                loan.IncredErrorMessage = _getString(result, "message") ?? "InCred status polling failed";
                await _db.SaveChangesAsync();
                return;
            }

            if (!result.TryGetProperty("response", out var respData))
            {
                // status:true but no "response" object — unexpected shape from InCred.
                // Previously this returned with zero trace, so a poll that silently
                // did nothing looked identical to a poll that succeeded. Log it so
                // it's visible in production, without changing the no-op behavior
                // itself (we genuinely have nothing usable to persist here).
                _log.LogWarning("InCred poll status (loan {LoanId}): status=true but response body missing", loan.Id);
                return;
            }

            loan.IncredApplicationId = _getString(respData, "APPLICATION_ID") ?? loan.IncredApplicationId;
            loan.IncredRequestId     = _getString(respData, "REQUEST_ID") ?? loan.IncredRequestId;
            loan.IncredOfferStatus   = _getString(respData, "STATUS")?.ToLowerInvariant();
            loan.IncredOfferJson     = respData.GetRawText();
            loan.IncredRejectReason  = _getString(respData, "REJECT_REASON") ?? _getString(respData, "ERROR");
            loan.IncredErrorMessage  = null;
            loan.IncredLastSyncedAt  = DateTime.UtcNow;

            // Replace offer lines with the latest snapshot from InCred.
            _db.LoanOffers.RemoveRange(loan.IncredOffers);
            if (respData.TryGetProperty("LOAN_OFFERS", out var offers) && offers.ValueKind == JsonValueKind.Array)
            {
                foreach (var offer in offers.EnumerateArray())
                {
                    _db.LoanOffers.Add(new LoanOffer
                    {
                        LoanId        = loan.Id,
                        OfferType     = _getString(offer, "TYPE"),
                        LoanAmount    = _getDecimal(offer, "LOAN_AMOUNT"),
                        LoanMaxTenure = _getInt(offer, "LOAN_MAX_TENURE"),
                        LoanRate      = _getDecimal(offer, "LOAN_RATE"),
                        ProcessingFee = _getDecimal(offer, "PROCESSING_FEE"),
                    });
                }
            }
            await _db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred poll offer error (loan {LoanId})", loan.Id);
            loan.IncredErrorMessage = ex.Message;
            await _db.SaveChangesAsync();
        }
    }

    private static IncredLoanInfoDto _mapIncredInfo(Loan loan) => new()
    {
        LoanId                  = loan.Id,
        IsIncredApplication     = loan.ApplicationSource == "incred",
        ApplicationSource       = loan.ApplicationSource,
        IncredApplicationId     = loan.IncredApplicationId,
        IncredCustomerId        = loan.IncredCustomerId,
        IncredRequestId         = loan.IncredRequestId,
        IncredOfferStatus       = loan.IncredOfferStatus,
        IncredErrorMessage      = loan.IncredErrorMessage,
        IncredRejectReason      = loan.IncredRejectReason,
        IncredLastWebhookEvent  = loan.IncredLastWebhookEvent,
        IncredLastWebhookStatus = loan.IncredLastWebhookStatus,
        IncredLastSyncedAt      = loan.IncredLastSyncedAt,
        Offers = loan.IncredOffers.Select(o => new LoanOfferDto
        {
            Id = o.Id, OfferType = o.OfferType, LoanAmount = o.LoanAmount,
            LoanMaxTenure = o.LoanMaxTenure, LoanRate = o.LoanRate, ProcessingFee = o.ProcessingFee,
        }).ToList(),
    };

    // ── Small JSON helpers: InCred sometimes returns numbers as strings ────────
    private static bool _getBool(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.True;

    private static string? _getString(JsonElement el, string prop) =>
        el.TryGetProperty(prop, out var v) ? v.GetString() : null;

    private static decimal _getDecimal(JsonElement el, string prop)
    {
        if (!el.TryGetProperty(prop, out var v)) return 0;
        if (v.ValueKind == JsonValueKind.Number) return v.GetDecimal();
        if (v.ValueKind == JsonValueKind.String && decimal.TryParse(v.GetString(), out var d)) return d;
        return 0;
    }

    private static int _getInt(JsonElement el, string prop)
    {
        if (!el.TryGetProperty(prop, out var v)) return 0;
        if (v.ValueKind == JsonValueKind.Number) return v.GetInt32();
        if (v.ValueKind == JsonValueKind.String && int.TryParse(v.GetString(), out var i)) return i;
        return 0;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/incred/loan/application/eligibility  (mirrors incredCheckEligibility)
    // ─────────────────────────────────────────────────────────────────────────
    [HttpPost("loan/application/eligibility")]
    public async Task<IActionResult> CheckEligibility([FromBody] JsonElement payload)
    {
        var creds = await _loadCreds();

        try
        {
            var (_, body) = await _execIncredCallAsync(
                HttpMethod.Post,
                $"{creds.baseUrl}/loan/application/eligibility",
                creds, payload.GetRawText(), "eligibility check", HttpContext.RequestAborted
            );
            return Content(body, "application/json");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred eligibility check error");
            return StatusCode(502, new { status = false, message = ex.Message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/incred/loan/application/{id}/document  (mirrors incredUploadDocument)
    // ─────────────────────────────────────────────────────────────────────────
    [HttpPost("loan/application/{id}/document")]
    public async Task<IActionResult> UploadDocument(string id, [FromBody] JsonElement payload)
    {
        var creds = await _loadCreds();

        try
        {
            var (_, body) = await _execIncredCallAsync(
                HttpMethod.Post,
                $"{creds.baseUrl}/loan/application/{id}/document",
                creds, payload.GetRawText(), "document upload", HttpContext.RequestAborted
            );
            return Content(body, "application/json");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred document upload error");
            return StatusCode(502, new { status = false, message = ex.Message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/incred/loan/application/{id}/cancel  (mirrors incredCancelApp)
    // ─────────────────────────────────────────────────────────────────────────
    [HttpPost("loan/application/{id}/cancel")]
    public async Task<IActionResult> CancelApplication(string id, [FromBody] JsonElement payload)
    {
        var creds = await _loadCreds();

        try
        {
            var (_, body) = await _execIncredCallAsync(
                HttpMethod.Post,
                $"{creds.baseUrl}/loan/application/{id}/cancel",
                creds, payload.GetRawText(), "cancel application", HttpContext.RequestAborted
            );
            return Content(body, "application/json");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred cancel application error");
            return StatusCode(502, new { status = false, message = ex.Message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/incred/loan/application/{id}/repayment-schedule  (mirrors incredGetRepaymentSchedule)
    // ─────────────────────────────────────────────────────────────────────────
    [HttpGet("loan/application/{id}/repayment-schedule")]
    public async Task<IActionResult> GetRepaymentSchedule(string id)
    {
        var creds = await _loadCreds();

        try
        {
            var (_, body) = await _execIncredCallAsync(
                HttpMethod.Get,
                $"{creds.baseUrl}/loan/application/{id}/repayment-schedule",
                creds, null, "repayment schedule", HttpContext.RequestAborted
            );
            return Content(body, "application/json");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred repayment schedule error");
            return StatusCode(502, new { status = false, message = ex.Message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PATCH /api/incred/loan/application/{id}/applicant  (mirrors incredUpdateApplicant)
    // ─────────────────────────────────────────────────────────────────────────
    [HttpPatch("loan/application/{id}/applicant")]
    public async Task<IActionResult> UpdateApplicant(string id, [FromBody] JsonElement payload)
    {
        var creds = await _loadCreds();

        try
        {
            var (_, body) = await _execIncredCallAsync(
                HttpMethod.Patch,
                $"{creds.baseUrl}/loan/application/{id}/applicant",
                creds, payload.GetRawText(), "update applicant", HttpContext.RequestAborted
            );
            return Content(body, "application/json");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred update applicant error");
            return StatusCode(502, new { status = false, message = ex.Message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/incred/loan/application/{id}/disbursement  (mirrors incredGetDisbursement)
    // ─────────────────────────────────────────────────────────────────────────
    [HttpGet("loan/application/{id}/disbursement")]
    public async Task<IActionResult> GetDisbursement(string id)
    {
        var creds = await _loadCreds();

        try
        {
            var (_, body) = await _execIncredCallAsync(
                HttpMethod.Get,
                $"{creds.baseUrl}/loan/application/{id}/disbursement",
                creds, null, "disbursement", HttpContext.RequestAborted
            );
            return Content(body, "application/json");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred disbursement error");
            return StatusCode(502, new { status = false, message = ex.Message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /incred/loan/webhook — inbound webhook receiver (mirrors webhook.py)
    // InCred's server calls this URL directly with APPLICATION_ID / PARTNER_REFERENCE
    // / EVENT / STATUS. Exposed at the root path (not under /api/incred) to match
    // the callback URL configured with InCred, same as the reference implementation.
    // Was previously MISSING entirely — no inbound endpoint existed, so real InCred
    // callbacks had nowhere to land and the Webhook Logs panel only ever showed mock data.
    // ─────────────────────────────────────────────────────────────────────────
    private const string KEY_WEBHOOK_LOGS = "incred_webhook_logs";

    // PHASE 6 FIX: the class was changed from [AllowAnonymous] to [Authorize]
    // (see class-level comment above) to stop anonymous internet callers from
    // driving the InCred proxy endpoints. That change would have also broken
    // THIS endpoint — InCred's own server calls this URL directly with no
    // LoanMS login, so it must stay reachable without a JWT. [AllowAnonymous]
    // on a method always overrides a class-level [Authorize], so this one
    // endpoint is deliberately re-opened while everything else in the
    // controller now requires authentication.
    [AllowAnonymous]
    [HttpPost]
    [Route("/incred/loan/webhook")]
    public async Task<IActionResult> ReceiveWebhook([FromBody] JsonElement payload)
    {
        try
        {
            // Same guard as CreateApplication/OfferRequest/PollOfferStatus: an empty
            // body or non-JSON Content-Type hands us a default JsonElement whose
            // GetRawText()/TryGetProperty() calls throw InvalidOperationException —
            // caught below regardless, but with a misleading message. Report it
            // plainly instead so a bad InCred callback is easy to diagnose in logs.
            if (payload.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
            {
                _log.LogWarning("InCred webhook received an empty/invalid JSON body");
                return Ok(new { status = "error", message = "Request body is missing or is not valid JSON." });
            }

            _log.LogInformation("Received InCred Webhook: {Payload}", payload.GetRawText());

            string? applicationId = payload.TryGetProperty("APPLICATION_ID", out var a) ? a.GetString() : null;
            string? partnerRef    = payload.TryGetProperty("PARTNER_REFERENCE", out var p) ? p.GetString() : null;
            string? evt           = payload.TryGetProperty("EVENT", out var e) ? e.GetString() : null;
            string? status        = payload.TryGetProperty("STATUS", out var s) ? s.GetString() : null;

            // Loans now live in the DB (see matching block below), so we match here
            // server-side against APPLICATION_ID / PARTNER_REFERENCE. Still log the
            // raw event either way, even if no Loan matches.
            if (string.IsNullOrEmpty(applicationId) && string.IsNullOrEmpty(partnerRef))
            {
                _log.LogWarning("InCred webhook missing both APPLICATION_ID and PARTNER_REFERENCE");
                return Ok(new { status = "error", message = "Application not found" });
            }

            var entry = new WebhookLogEntry
            {
                AppId  = applicationId,
                Ref    = partnerRef,
                Event  = evt,
                Status = status,
                Time   = DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm"),
                Ok     = string.Equals(status, "SUCCESS", StringComparison.OrdinalIgnoreCase),
            };

            // ── Persist onto the matching Loan row (not just the raw log) ────────
            // PARTNER_REFERENCE is set to loan.Id.ToString() when we create the
            // InCred application (see CreateIncredApplicationForLoan), so match on
            // either that or the InCred-issued APPLICATION_ID. This was previously
            // missing — IncredLastWebhookEvent/IncredLastWebhookStatus exist on the
            // Loan entity and are already returned by GetLoanIncredInfo, but nothing
            // ever wrote to them, so they stayed null forever.
            Loan? matchedLoan = null;
            if (!string.IsNullOrEmpty(applicationId))
                matchedLoan = await _db.Loans.FirstOrDefaultAsync(l => l.IncredApplicationId == applicationId);
            if (matchedLoan == null && !string.IsNullOrEmpty(partnerRef) && int.TryParse(partnerRef, out var refLoanId))
                matchedLoan = await _db.Loans.FirstOrDefaultAsync(l => l.Id == refLoanId);

            if (matchedLoan != null)
            {
                matchedLoan.IncredLastWebhookEvent  = evt;
                matchedLoan.IncredLastWebhookStatus = status;
                matchedLoan.IncredLastSyncedAt      = DateTime.UtcNow;
            }
            else
            {
                _log.LogWarning("InCred webhook: no matching Loan found for APPLICATION_ID={AppId} / PARTNER_REFERENCE={Ref}",
                    applicationId, partnerRef);
            }

            var setting = await _db.AppSettings.FirstOrDefaultAsync(x => x.Key == KEY_WEBHOOK_LOGS);
            var logs = new List<WebhookLogEntry>();
            if (setting != null && !string.IsNullOrEmpty(setting.Value))
            {
                try { logs = JsonSerializer.Deserialize<List<WebhookLogEntry>>(setting.Value) ?? new(); }
                catch { logs = new(); }
            }
            logs.Insert(0, entry);
            if (logs.Count > 100) logs = logs.Take(100).ToList();

            var value = JsonSerializer.Serialize(logs);
            if (setting != null)
            {
                setting.Value = value; setting.UpdatedAt = DateTime.UtcNow; setting.IsDeleted = false;
            }
            else
            {
                _db.AppSettings.Add(new AppSetting
                {
                    Key = KEY_WEBHOOK_LOGS, Value = value,
                    Category = "incred", CreatedAt = DateTime.UtcNow
                });
            }
            await _db.SaveChangesAsync();

            return Ok(new { status = "success", message = "Webhook processed successfully" });
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred webhook processing error");
            return Ok(new { status = "error", message = ex.Message });
        }
    }

    // NOTE: webhook logs are now served by the Admin-only
    // GET /api/settings/webhook-logs endpoint (SettingsController) instead of
    // from here — the inbound webhook receiver above is individually marked
    // [AllowAnonymous] (required since InCred's server calls it without a
    // login), while the rest of this controller now requires authentication
    // (see PHASE 6 fix above), so a GET action placed here would previously
    // have been readable by anyone via the old class-wide anonymous access.
    // Settings → System & Data → Webhook Logs now points at the properly
    // Admin-gated endpoint.
    private class WebhookLogEntry
    {
        [JsonPropertyName("appId")]  public string? AppId  { get; set; }
        [JsonPropertyName("ref")]    public string? Ref    { get; set; }
        [JsonPropertyName("event")]  public string? Event  { get; set; }
        [JsonPropertyName("status")] public string? Status { get; set; }
        [JsonPropertyName("time")]   public string? Time   { get; set; }
        [JsonPropertyName("ok")]     public bool Ok        { get; set; }
    }

    // ── Map our stored Gender ("Male"/"Female"/"Other") to InCred's exact "M"/"F".
    // Returns null when there's no valid mapping (missing, or "Other" — InCred's
    // application/init API has no value for it), so the caller can fail fast.
    // internal (not private): lets LoanMS.Tests exercise these mapping rules directly
    // without going through a full HTTP-mocked controller call. No behavior change —
    // still only callable from within this assembly plus the test assembly below.
    internal static string? _mapGenderForIncred(string? gender)
    {
        var g = (gender ?? "").Trim();
        if (g.Equals("Male", StringComparison.OrdinalIgnoreCase) || g.Equals("M", StringComparison.OrdinalIgnoreCase))
            return "M";
        if (g.Equals("Female", StringComparison.OrdinalIgnoreCase) || g.Equals("F", StringComparison.OrdinalIgnoreCase))
            return "F";
        return null;
    }

    // ── Map our stored ResidenceType (app's own values: Owned/Rented/Company
    // Provided/Parental/Other) to InCred's fixed RESIDENCE_TYPE enum. Only maps
    // values with an unambiguous match; everything else returns null so the
    // caller omits the optional field rather than guessing.
    // "Rented" maps to RENTED_SELF_WITH_FAMILY — the same InCred code already
    // used for the plain "Rented" option elsewhere in this app (see the
    // wizard's home_type master list and BL_HOME_TYPES in efin-app.js), kept
    // consistent with that existing convention rather than introducing a new one.
    // ── Map our stored EmploymentType ("Salaried"/"Self-Employed"/"Professional",
    // set by the wizard) to InCred's exact SALARIED/SELFEMP/NOTEARNING enum.
    // "Professional" (doctor/CA/lawyer etc.) has no InCred category of its own,
    // so it's treated as self-employed for this purpose.
    internal static string? _mapEmploymentTypeForIncred(string? employmentType)
    {
        var e = (employmentType ?? "").Trim();
        if (e.Equals("Salaried", StringComparison.OrdinalIgnoreCase) || e.Equals("SALARIED", StringComparison.OrdinalIgnoreCase))
            return "SALARIED";
        if (e.Equals("Self-Employed", StringComparison.OrdinalIgnoreCase) || e.Equals("SELFEMP", StringComparison.OrdinalIgnoreCase) || e.Equals("Professional", StringComparison.OrdinalIgnoreCase))
            return "SELFEMP";
        if (e.Equals("Not Earning", StringComparison.OrdinalIgnoreCase) || e.Equals("NOTEARNING", StringComparison.OrdinalIgnoreCase))
            return "NOTEARNING";
        return null;
    }

    private static readonly Dictionary<string, string> _residenceTypeMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Owned"]            = "OWNED_SELF_SPOUSE",
        ["Rented"]           = "RENTED_SELF_WITH_FAMILY",
        ["Parental"]         = "OWNED_BY_PARENTS",
        ["Company Provided"] = "RENTED_ACCOMMODATION_BY_EMPLOYER",
    };
    internal static string? _mapResidenceTypeForIncred(string? residenceType)
    {
        if (string.IsNullOrWhiteSpace(residenceType)) return null;
        return _residenceTypeMap.TryGetValue(residenceType.Trim(), out var mapped) ? mapped : null;
    }
}
