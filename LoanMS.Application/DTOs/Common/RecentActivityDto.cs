namespace LoanMS.Application.DTOs;

// ── Dashboard Recent Activity (Gap 2) ────────────────────────────────────────
// The DB-backed equivalent of Vanilla's ACTIVITY_LOG (efin-app.js
// pushActivity/renderActivity), merged from TWO real, persisted sources —
// never generated/in-memory data:
//   Type == "Loan"  — a LoanStatusHistory row (loan created / every status
//                      change), scoped to loans visible to the caller. This
//                      alone covers pushActivity's loan-lifecycle call sites
//                      (create, submit/approve/reject/disburse/hold/
//                      override/deviation).
//   Type == "Audit" — a row from the generic AuditLogs table (written by
//                      AuditMiddleware for every successful POST/PUT/PATCH/
//                      DELETE to /api/*), for the non-loan pushActivity
//                      categories that DO have a persisted equivalent there:
//                      Users (create/update/delete/reset-password/invite —
//                      invite has no distinct backend action of its own, see
//                      GetRecentActivityAsync), Tracking (per-loan timeline
//                      entry edit/delete — TrackingController), and Incred
//                      (lender-sync writes — IncredController). Only
//                      populated for Admin callers — AuditController itself
//                      is Admin-only ([Authorize(Roles="Admin")]), so this
//                      mirrors that same boundary instead of newly exposing
//                      admin-sensitive audit data (who reset whose password,
//                      etc.) to every other role's dashboard.
//   PENDING — one Vanilla pushActivity category still has no reliably
//   attributable persisted source: custom-role create/update/delete
//   (efin-app.js:28658/28682) is stored as an undifferentiated blob write
//   under the "efin_role_permissions" settings key (SettingsController), not
//   a discrete per-role record, so it cannot be described here without
//   fabricating detail the data doesn't actually contain.
public class RecentActivityDto
{
    /// <summary>"Loan" or "Audit" — which source produced this row, and
    /// which of the field groups below is populated.</summary>
    public string Type { get; set; } = "Loan";

    // ── Type == "Loan" fields (LoanStatusHistory-sourced) ───────────────────
    public int? LoanId { get; set; }
    public string? LoanNumber { get; set; }
    public string? CustomerName { get; set; }
    /// <summary>The status the loan moved TO — LoanStatus.ToString(), same
    /// convention as LoanListDto.Status.</summary>
    public string? Status { get; set; }

    // ── Type == "Audit" fields (AuditLog-sourced) ───────────────────────────
    /// <summary>AuditLog.EntityName ("Users"/"Tracking"/"Incred").</summary>
    public string? EntityName { get; set; }
    /// <summary>AuditLog.Action ("Created"/"Updated"/"Deleted"/
    /// "StatusChanged") — same convention AuditLogPage already renders.</summary>
    public string? Action { get; set; }
    /// <summary>Human-readable summary built from the AuditLog row (entity +
    /// action + who). Not a verbatim reproduction of Vanilla's exact
    /// pushActivity() text — AuditMiddleware's generic write log doesn't
    /// capture the field-level detail Vanilla's purpose-built call sites do
    /// (e.g. old→new name) — but it is a real, persisted description of a
    /// real event, not fabricated.</summary>
    public string? Description { get; set; }

    public DateTime ChangedAt { get; set; }
}
