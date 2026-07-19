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
/// Credentials: read from DB (encrypted). Falls back to built-in defaults
/// so the app works on fresh install without any Settings configuration.
/// </summary>
[AllowAnonymous] // InCred proxy — secured by InCred's own OAuth2 (client_credentials)
public class IncredController : BaseController
{
    private const string KEY_BASE_URL      = "incred_base_url";
    private const string KEY_CLIENT_ID     = "incred_client_id";
    private const string KEY_CLIENT_SECRET = "incred_client_secret_enc";

    // ── Built-in fallback credentials (same as incred_mixin.py hardcoded values) ──
    // These match: client_id="5251599593571026P" / client_secret="VGCm5yu8wSCfog4zL8gdqf353Rj08gXi"
    private const string DEFAULT_BASE_URL       = "https://api.incred.com/v3";
    private const string DEFAULT_CLIENT_ID      = "5251599593571026P";
    private const string DEFAULT_CLIENT_SECRET  = "VGCm5yu8wSCfog4zL8gdqf353Rj08gXi";

    private readonly AppDbContext _db;
    private readonly IHttpClientFactory _http;
    private readonly IDataProtector _protector;
    private readonly ILogger<IncredController> _log;

    public IncredController(AppDbContext db, IHttpClientFactory http,
        IDataProtectionProvider dpProvider, ILogger<IncredController> log)
    {
        _db = db;
        _http = http;
        _protector = dpProvider.CreateProtector("LoanMS.InCredSecrets.v1");
        _log = log;
    }

    // ── Load credentials from DB; fall back to built-in if not configured ────
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
                _log.LogWarning(ex, "Failed to decrypt InCred secret from DB — using built-in defaults");
            }
        }

        // Fall back to built-in defaults (matches incred_mixin.py hardcoded values)
        _log.LogInformation("InCred credentials not in DB — using built-in defaults");
        return (DEFAULT_BASE_URL, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET);
    }

    // ── Get JWT token from InCred (mirrors incred_get_token) ─────────────────
    private async Task<string?> _getToken((string baseUrl, string clientId, string clientSecret) creds)
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
                $"{creds.baseUrl}/auth/incred/protocol/openid-connect/token", form);

            if (!resp.IsSuccessStatusCode)
            {
                var errBody = await resp.Content.ReadAsStringAsync();
                _log.LogError("InCred token HTTP {Status}: {Body}", resp.StatusCode, errBody[..Math.Min(errBody.Length, 200)]);
                return null;
            }

            var json = await resp.Content.ReadAsStringAsync();
            var doc  = JsonDocument.Parse(json);
            var tok  = doc.RootElement.TryGetProperty("access_token", out var t) ? t.GetString() : null;
            if (string.IsNullOrEmpty(tok))
                _log.LogError("InCred token response had no access_token: {Json}", json[..Math.Min(json.Length, 200)]);
            return tok;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred _getToken error");
            return null;
        }
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
        var creds = await _loadCreds();
        var token = await _getToken(creds);
        if (token == null)
            return StatusCode(502, new { status = false, message = "Failed to get InCred token" });

        try
        {
            var client  = _http.CreateClient("incred");
            var req     = _buildRequest(
                HttpMethod.Post,
                $"{creds.baseUrl}/digital-partner/application/init",
                token,
                payload.GetRawText()
            );
            var resp = await client.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            _log.LogInformation("InCred create app [{Status}]: {Body}",
                resp.StatusCode, body[..Math.Min(body.Length, 300)]);
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
        var creds = await _loadCreds();
        var token = await _getToken(creds);
        if (token == null)
            return StatusCode(502, new { status = false, message = "Failed to get InCred token" });

        try
        {
            var client = _http.CreateClient("incred");
            var req    = _buildRequest(
                HttpMethod.Post,
                $"{creds.baseUrl}/digital-partner/offer/request",
                token,
                payload.GetRawText()
            );
            var resp = await client.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            _log.LogInformation("InCred offer request [{Status}]: {Body}",
                resp.StatusCode, body[..Math.Min(body.Length, 300)]);
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
        var creds = await _loadCreds();
        var token = await _getToken(creds);
        if (token == null)
            return StatusCode(502, new { status = false, message = "Failed to get InCred token" });

        try
        {
            var client = _http.CreateClient("incred");
            var req    = _buildRequest(
                HttpMethod.Post,
                $"{creds.baseUrl}/digital-partner/offer/status",
                token,
                payload.GetRawText()
            );
            var resp = await client.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            _log.LogInformation("InCred poll status [{Status}]: {Body}",
                resp.StatusCode, body[..Math.Min(body.Length, 300)]);
            return Content(body, "application/json");
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "InCred poll status error");
            return StatusCode(502, new { status = false, message = ex.Message });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/incred/loan/application/eligibility  (mirrors incredCheckEligibility)
    // ─────────────────────────────────────────────────────────────────────────
    [HttpPost("loan/application/eligibility")]
    public async Task<IActionResult> CheckEligibility([FromBody] JsonElement payload)
    {
        var creds = await _loadCreds();
        var token = await _getToken(creds);
        if (token == null)
            return StatusCode(502, new { status = false, message = "Failed to get InCred token" });

        try
        {
            var client = _http.CreateClient("incred");
            var req    = _buildRequest(
                HttpMethod.Post,
                $"{creds.baseUrl}/loan/application/eligibility",
                token,
                payload.GetRawText()
            );
            var resp = await client.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            _log.LogInformation("InCred eligibility check [{Status}]: {Body}",
                resp.StatusCode, body[..Math.Min(body.Length, 300)]);
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
        var token = await _getToken(creds);
        if (token == null)
            return StatusCode(502, new { status = false, message = "Failed to get InCred token" });

        try
        {
            var client = _http.CreateClient("incred");
            var req    = _buildRequest(
                HttpMethod.Post,
                $"{creds.baseUrl}/loan/application/{id}/document",
                token,
                payload.GetRawText()
            );
            var resp = await client.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            _log.LogInformation("InCred document upload [{Status}]: {Body}",
                resp.StatusCode, body[..Math.Min(body.Length, 300)]);
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
        var token = await _getToken(creds);
        if (token == null)
            return StatusCode(502, new { status = false, message = "Failed to get InCred token" });

        try
        {
            var client = _http.CreateClient("incred");
            var req    = _buildRequest(
                HttpMethod.Post,
                $"{creds.baseUrl}/loan/application/{id}/cancel",
                token,
                payload.GetRawText()
            );
            var resp = await client.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            _log.LogInformation("InCred cancel application [{Status}]: {Body}",
                resp.StatusCode, body[..Math.Min(body.Length, 300)]);
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
        var token = await _getToken(creds);
        if (token == null)
            return StatusCode(502, new { status = false, message = "Failed to get InCred token" });

        try
        {
            var client = _http.CreateClient("incred");
            var req    = _buildRequest(
                HttpMethod.Get,
                $"{creds.baseUrl}/loan/application/{id}/repayment-schedule",
                token
            );
            var resp = await client.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            _log.LogInformation("InCred repayment schedule [{Status}]: {Body}",
                resp.StatusCode, body[..Math.Min(body.Length, 300)]);
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
        var token = await _getToken(creds);
        if (token == null)
            return StatusCode(502, new { status = false, message = "Failed to get InCred token" });

        try
        {
            var client = _http.CreateClient("incred");
            var req    = _buildRequest(
                HttpMethod.Patch,
                $"{creds.baseUrl}/loan/application/{id}/applicant",
                token,
                payload.GetRawText()
            );
            var resp = await client.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            _log.LogInformation("InCred update applicant [{Status}]: {Body}",
                resp.StatusCode, body[..Math.Min(body.Length, 300)]);
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
        var token = await _getToken(creds);
        if (token == null)
            return StatusCode(502, new { status = false, message = "Failed to get InCred token" });

        try
        {
            var client = _http.CreateClient("incred");
            var req    = _buildRequest(
                HttpMethod.Get,
                $"{creds.baseUrl}/loan/application/{id}/disbursement",
                token
            );
            var resp = await client.SendAsync(req);
            var body = await resp.Content.ReadAsStringAsync();
            _log.LogInformation("InCred disbursement [{Status}]: {Body}",
                resp.StatusCode, body[..Math.Min(body.Length, 300)]);
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

    [HttpPost]
    [Route("/incred/loan/webhook")]
    public async Task<IActionResult> ReceiveWebhook([FromBody] JsonElement payload)
    {
        try
        {
            _log.LogInformation("Received InCred Webhook: {Payload}", payload.GetRawText());

            string? applicationId = payload.TryGetProperty("APPLICATION_ID", out var a) ? a.GetString() : null;
            string? partnerRef    = payload.TryGetProperty("PARTNER_REFERENCE", out var p) ? p.GetString() : null;
            string? evt           = payload.TryGetProperty("EVENT", out var e) ? e.GetString() : null;
            string? status        = payload.TryGetProperty("STATUS", out var s) ? s.GetString() : null;

            // mirrors webhook.py: match is done client-side against APPLICATION_ID / PARTNER_REFERENCE
            // (applications live in the browser, not in this table) — log the raw event either way.
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

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/incred/webhook/logs — recent webhook events, for the Webhook Logs panel
    // ─────────────────────────────────────────────────────────────────────────
    [HttpGet("webhook/logs")]
    public async Task<IActionResult> GetWebhookLogs()
    {
        var setting = await _db.AppSettings.FirstOrDefaultAsync(x => x.Key == KEY_WEBHOOK_LOGS);
        if (setting == null || string.IsNullOrEmpty(setting.Value))
            return Ok(new { logs = Array.Empty<WebhookLogEntry>() });

        try
        {
            var logs = JsonSerializer.Deserialize<List<WebhookLogEntry>>(setting.Value) ?? new();
            return Ok(new { logs });
        }
        catch
        {
            return Ok(new { logs = Array.Empty<WebhookLogEntry>() });
        }
    }

    private class WebhookLogEntry
    {
        [JsonPropertyName("appId")]  public string? AppId  { get; set; }
        [JsonPropertyName("ref")]    public string? Ref    { get; set; }
        [JsonPropertyName("event")]  public string? Event  { get; set; }
        [JsonPropertyName("status")] public string? Status { get; set; }
        [JsonPropertyName("time")]   public string? Time   { get; set; }
        [JsonPropertyName("ok")]     public bool Ok        { get; set; }
    }
}
