using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Team ──────────────────────────────────────────────────────────────────────
public class Team : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = "Sales";  // Sales | Login
    public int? LocationId { get; set; }
    public int? TeamLeadUserId { get; set; }

    // Confirmed real gap (Team Archive/Active status was session/local-
    // only — reset to Active on every refresh/logout/new-device): the
    // only persistent state Team had at all was soft-delete (IsDeleted).
    // Default true — a newly created team starts Active, matching the
    // explicit requirement, and every existing team safely defaults to
    // Active too (there was never any reliable prior archive-signal to
    // preserve, per the migration's own backfill).
    public bool IsActive { get; set; } = true;

    public Location? Location { get; set; }
    public User? TeamLead { get; set; }
    public ICollection<TeamMember> Members { get; set; } = new List<TeamMember>();
}
