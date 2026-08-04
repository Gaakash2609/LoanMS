namespace LoanMS.Domain.Entities;

// ── Report Targets (Reports & Analytics — monthly KPI targets) ─────────────
/// <summary>
/// Monthly performance targets shown on the Reports &amp; Analytics KPI cards
/// (Total Disbursed / Logins / Disbursement Count) and edited from the
/// "Target Editor" panel on that page.
///
/// Field layout intentionally mirrors the existing RPT_TARGETS object in
/// efin-app.js exactly — one row per calendar month (TargetMonth,
/// "YYYY-MM") holding the three numeric targets the UI already reads/writes
/// (DisbAmt, LoginCount, DisbCount) — rather than a generic
/// TargetType/TargetValue (EAV) layout. RPT_TARGETS is read in several
/// places as a single object per month (e.g. `RPT_TARGETS[thisMonthKey].disbAmt`),
/// so keeping the same per-month shape server-side means the Reports
/// rendering logic itself needs zero changes — only where the data comes
/// from changes (DB instead of a hardcoded object).
///
/// UserId / TeamId are included as optional scoping columns per the task
/// requirement and for forward compatibility with future per-user/per-team
/// targets. Today's Target Editor UI only ever creates organization-wide
/// targets (both null) — matching current RPT_TARGETS behavior exactly,
/// which has no per-user/team dimension at all right now.
/// </summary>
public class ReportTarget : BaseEntity
{
    /// <summary>Month this target applies to, "YYYY-MM" (e.g. "2026-01").</summary>
    public string TargetMonth { get; set; } = string.Empty;

    /// <summary>Optional — scopes this target to one user. Null = organization-wide (current UI default).</summary>
    public int? UserId { get; set; }

    /// <summary>Optional — scopes this target to one team. Null = organization-wide (current UI default).</summary>
    public int? TeamId { get; set; }

    /// <summary>Monthly disbursement amount target (₹). Maps to RPT_TARGETS[month].disbAmt.</summary>
    public decimal DisbAmt { get; set; }

    /// <summary>Monthly login-count target. Maps to RPT_TARGETS[month].loginCount.</summary>
    public int LoginCount { get; set; }

    /// <summary>Monthly disbursement-count target. Maps to RPT_TARGETS[month].disbCount.</summary>
    public int DisbCount { get; set; }

    /// <summary>User who created/last edited this target (audit only; not used for ownership checks).</summary>
    public int? CreatedByUserId { get; set; }
}
