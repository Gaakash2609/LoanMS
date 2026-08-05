namespace LoanMS.Domain.Entities;

// ── Login Attempt (server-side lockout) ───────────────────────────────────
/// <summary>
/// One FAILED login attempt, recorded for lockout purposes. Only failures
/// are stored — a successful login clears any prior failed rows for that
/// email (see AuthController.Login). Rows older than the lockout window are
/// irrelevant and can be purged periodically; they are not a long-term audit
/// log (AuditLog / AssignmentAuditLog already cover that).
///
/// Was previously enforced only client-side (efin_login_lock in
/// localStorage) — trivially bypassed by clearing localStorage or using a
/// different browser/incognito window, so it was UX-only, not real
/// security. The frontend lock now purely mirrors this server state for
/// instant UI feedback; the server is the sole enforcement point.
/// </summary>
public class LoginAttempt : BaseEntity
{
    public string Email { get; set; } = string.Empty;
    public string IpAddress { get; set; } = string.Empty;
}
