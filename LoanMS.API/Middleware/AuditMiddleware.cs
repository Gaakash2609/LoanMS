using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
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

    private static readonly HashSet<string> _auditMethods = new(StringComparer.OrdinalIgnoreCase)
        { "POST", "PUT", "PATCH", "DELETE" };

    private static readonly HashSet<string> _skipPaths = new(StringComparer.OrdinalIgnoreCase)
        { "/api/auth/login", "/api/auth/refresh", "/api/auth/logout", "/swagger" };

    // JSON field names whose values must be masked in audit records
    private static readonly HashSet<string> _piiFields = new(StringComparer.OrdinalIgnoreCase)
        { "pan", "aadhar", "aadhaar", "aadhaarnumber", "pannumber", "mobile", "phone",
          "password", "currentpassword", "newpassword", "dob", "dateofbirth", "refreshtoken" };

    public AuditMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext ctx, AppDbContext db)
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
            try
            {
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

                db.AuditLogs.Add(new AuditLog
                {
                    EntityName = Capitalize(entityName),
                    Action     = action,
                    EntityId   = entityId,
                    NewValues  = TruncateJson(maskedBody, 2000),
                    UserName   = userName,
                    UserId     = userId,
                    IpAddress  = ip,
                    CreatedAt  = DateTime.UtcNow
                });
                await db.SaveChangesAsync();
            }
            catch { /* Audit failure must never break the main request */ }
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
