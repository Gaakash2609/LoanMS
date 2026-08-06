using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LoanMS.API.Middleware;

/// <summary>
/// Audit middleware — logs all write operations (POST/PUT/PATCH/DELETE) to AuditLogs table.
/// PII fields (PAN, Aadhaar, mobile, DOB, password) are masked before storage.
/// </summary>
public class AuditMiddleware
{
    private readonly RequestDelegate _next;
    // Root cause of "every save feels slow, across every module": this
    // middleware wraps EVERY POST/PUT/PATCH/DELETE in the app (loans,
    // users, customers, obligations, wizard, RM emails, everything), and
    // previously called db.SaveChangesAsync() for the audit row itself
    // BEFORE letting the request finish — i.e. every single write request
    // paid for two sequential DB round-trips (the real save + the audit
    // save) before the browser saw a response. That is a universal,
    // per-request tax on the whole app, not something specific to any one
    // screen — which matches the save being slow "sabhi me". The request's
    // own scoped AppDbContext is disposed the moment this method returns,
    // so the audit write is moved onto a fresh short-lived scope via
    // IServiceScopeFactory and fired without awaiting it — the user's
    // response is no longer held up by the audit log write, while the
    // audit trail itself (including PII masking) still happens exactly as
    // before, just after the response has already gone out.
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<AuditMiddleware> _logger;

    private static readonly HashSet<string> _auditMethods = new(StringComparer.OrdinalIgnoreCase)
        { "POST", "PUT", "PATCH", "DELETE" };

    private static readonly HashSet<string> _skipPaths = new(StringComparer.OrdinalIgnoreCase)
        { "/api/auth/login", "/api/auth/refresh", "/api/auth/logout", "/swagger",
          // KYC vision uploads carry large base64 image payloads (up to 60MB).
          // Buffering them here for audit runs BEFORE KycController's own
          // [RequestSizeLimit] filter gets a chance to apply, which is what
          // caused "IHttpRequestBodySizeFeature ... read-only" warnings — and
          // there's no value in storing raw image bytes in the audit log anyway.
          "/api/kyc/vision" };

    // JSON field names whose values must be masked in audit records
    private static readonly HashSet<string> _piiFields = new(StringComparer.OrdinalIgnoreCase)
        { "pan", "aadhar", "aadhaar", "aadhaarnumber", "pannumber", "mobile", "phone",
          "password", "currentpassword", "newpassword", "dob", "dateofbirth", "refreshtoken" };

    public AuditMiddleware(RequestDelegate next, IServiceScopeFactory scopeFactory, ILogger<AuditMiddleware> logger)
    {
        _next = next;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext ctx)
    {
        var method = ctx.Request.Method;
        var path   = ctx.Request.Path.Value ?? "";

        var shouldAudit = _auditMethods.Contains(method) &&
                          path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase) &&
                          !_skipPaths.Any(s => path.StartsWith(s, StringComparison.OrdinalIgnoreCase));

        if (!shouldAudit) { await _next(ctx); return; }

        // Read request body
        ctx.Request.EnableBuffering();
        var bodyBytes  = await ReadBodyAsync(ctx.Request.Body);
        var bodyString = Encoding.UTF8.GetString(bodyBytes);
        ctx.Request.Body.Position = 0;

        // Capture response
        var origBody = ctx.Response.Body;
        using var memStream = new MemoryStream();
        ctx.Response.Body = memStream;

        await _next(ctx);

        memStream.Position = 0;
        var responseBody = await new StreamReader(memStream).ReadToEndAsync();
        memStream.Position = 0;
        await memStream.CopyToAsync(origBody);
        ctx.Response.Body = origBody;

        // Only log successful writes
        if (ctx.Response.StatusCode is >= 200 and < 300)
        {
            // Everything needed for the audit row is read from ctx HERE,
            // synchronously, while the request is still alive — ctx (and
            // the request's own scoped services) must not be touched from
            // inside the fire-and-forget task below, since ASP.NET Core
            // is free to recycle/dispose them the moment InvokeAsync
            // returns.
            var segments   = path.Trim('/').Split('/');
            var entityName = segments.Length >= 2 ? segments[1] : "Unknown";
            var entityId   = segments.Length >= 3 ? segments[2] : null;
            var action     = method.ToUpper() switch
            {
                "POST"   => "Created",
                "PUT"    => "Updated",
                "PATCH"  => "Updated",
                "DELETE" => "Deleted",
                _        => method
            };
            if (path.Contains("/status") || path.Contains("/approve") ||
                path.Contains("/reject") || path.Contains("/disburse"))
                action = "StatusChanged";

            var userId   = GetUserId(ctx);
            var userName = GetUserName(ctx);
            var ip       = ctx.Connection.RemoteIpAddress?.ToString();

            // Mask PII before storing — never write raw PAN / Aadhaar / passwords to audit log
            var maskedBody = MaskPiiFields(bodyString);

            var entry = new AuditLog
            {
                EntityName = Capitalize(entityName),
                Action     = action,
                EntityId   = entityId,
                NewValues  = TruncateJson(maskedBody, 2000),
                UserName   = userName,
                UserId     = userId,
                IpAddress  = ip,
                CreatedAt  = DateTime.UtcNow
            };

            // Deliberately not awaited: the user's response has already
            // been written to origBody above, so blocking here would only
            // add latency the caller never asked for. Errors are logged,
            // never thrown back into the request pipeline (which has
            // already completed by the time this runs).
            _ = PersistAuditAsync(entry);
        }
    }

    private async Task PersistAuditAsync(AuditLog entry)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.AuditLogs.Add(entry);
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            // Audit failure must never break the main request — by this
            // point the request is long finished, so just log it.
            _logger.LogWarning(ex, "Background audit log persist failed for {Entity} {Action}", entry.EntityName, entry.Action);
        }
    }

    /// <summary>
    /// Replace values of known PII JSON fields with masked placeholders.
    /// Works on raw JSON strings without full deserialisation to avoid
    /// losing unknown fields.
    /// </summary>
    private static string MaskPiiFields(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return json;
        try
        {
            // Regex: match "fieldName": "value" and replace value with [REDACTED]
            // Also handles numeric values (e.g. mobile stored as number)
            return Regex.Replace(
                json,
                @"""(?<field>[^""]+)""\s*:\s*(?:""(?<val>[^""]*)""|(?<numval>\d+))",
                m =>
                {
                    var field = m.Groups["field"].Value;
                    if (!_piiFields.Contains(field)) return m.Value;
                    // Preserve the key, mask the value
                    return m.Groups["numval"].Success
                        ? $"\"{field}\": \"[REDACTED]\""
                        : $"\"{field}\": \"[REDACTED]\"";
                },
                RegexOptions.IgnoreCase);
        }
        catch
        {
            // If regex fails for any reason, return a fully redacted marker
            return "[REDACTED — PII masking error]";
        }
    }

    private static async Task<byte[]> ReadBodyAsync(Stream body)
    {
        using var ms = new MemoryStream();
        await body.CopyToAsync(ms);
        return ms.ToArray();
    }

    private static int? GetUserId(HttpContext ctx)
    {
        var claim = ctx.User?.FindFirst("sub") ?? ctx.User?.FindFirst("id");
        return claim != null && int.TryParse(claim.Value, out var id) ? id : null;
    }

    private static string? GetUserName(HttpContext ctx) =>
        ctx.User?.FindFirst("name")?.Value ?? ctx.User?.FindFirst("email")?.Value;

    private static string TruncateJson(string json, int maxLen) =>
        string.IsNullOrEmpty(json) ? json
        : json.Length > maxLen ? json[..maxLen] + "…" : json;

    private static string Capitalize(string s) =>
        string.IsNullOrEmpty(s) ? s : char.ToUpper(s[0]) + s[1..];
}
