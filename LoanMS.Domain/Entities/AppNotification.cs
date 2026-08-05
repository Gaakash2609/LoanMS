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
}
