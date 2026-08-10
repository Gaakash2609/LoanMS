using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── App Notification (Management alerts) ────────────────────────────────────
/// <summary>
/// In-app notification, e.g. "payout claim submitted" alerts meant for
/// Admin/Accounts. Was frontend-only (notifyManagement() in efin-app.js,
/// localStorage key 'mgmt_notifications') — written to whichever browser
/// happened to trigger the event, so the intended recipient (Admin/Accounts,
/// possibly on a different device entirely) never actually saw it. Standalone,
/// not referenced by FK from other entities.
/// </summary>
public class AppNotification : BaseEntity
{
    public string Type { get; set; } = string.Empty;
    public string? ClaimId { get; set; }
    public string? Partner { get; set; }
    public decimal? Amount { get; set; }

    /// <summary>Role this notification is intended for (e.g. "Admin", "Accounts"). Null = all roles.</summary>
    public string? TargetRole { get; set; }

    public bool IsRead { get; set; } = false;

    // ── Generic topbar-bell fields (added) ──────────────────────────────────
    // The topbar notification bell (efin-app.js's NOTIF_STORE) shows a much
    // wider range of events than just payout claims — new application
    // created, status changed, rejected, disbursed, approved, auto-assigned
    // to Login stage — each with a short emoji Icon and a free-text Message
    // ("EFIN123 — John Doe approved for ₹500,000"). Type/ClaimId/Partner/
    // Amount above are too narrow to represent all of these generically, so
    // Icon/Message were added rather than inventing a second notification
    // table/endpoint for the bell. Both nullable: existing payout-claim
    // notifications (created before this change) simply have no Icon/
    // Message and the frontend falls back to a generic 🔔 + Type string.
    public string? Icon    { get; set; }
    public string? Message { get; set; }

    /// <summary>User-specific delivery (added — SLA breach/task-follow-up notifications
    /// target a specific responsible user, not a whole role). Null = role-broadcast
    /// (existing behavior, e.g. payout-claim management alerts) — TargetRole and
    /// TargetUserId are independent filters, either or both may be set.</summary>
    public int? TargetUserId { get; set; }
}
