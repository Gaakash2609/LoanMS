using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Http;

namespace LoanMS.API.Controllers;

/// <summary>
/// Phase 4 (G-22) — tiny shared helper for writing a STRUCTURED before/after
/// audit record for a sensitive mutation, capturing OldValues → NewValues +
/// Reason + who/when/IP. Complements the global AuditMiddleware (which records
/// the request body as NewValues but has no before-image): call this at the
/// exact point of a sensitive change, where the prior value is still known.
///
/// Same convention as AssignmentLogHelper: adds the row to the caller's
/// AppDbContext and does NOT SaveChanges — the caller's existing
/// SaveChangesAsync persists it atomically with the change it describes.
/// Never logs secrets; callers pass already-safe field summaries (status
/// strings, ids), never raw PII.
/// </summary>
internal static class AuditHelper
{
    public static void LogChange(
        AppDbContext db,
        HttpContext? http,
        string entityName,
        string entityId,
        string action,
        string? oldValues,
        string? newValues,
        string? reason,
        int? userId,
        string? userName)
    {
        db.AuditLogs.Add(new AuditLog
        {
            EntityName = entityName,
            Action     = action,
            EntityId   = entityId,
            OldValues  = oldValues,
            NewValues  = newValues,
            Reason     = reason,
            UserId     = userId,
            UserName   = userName,
            IpAddress  = http?.Connection.RemoteIpAddress?.ToString(),
            CreatedAt  = DateTime.UtcNow
        });
    }
}
