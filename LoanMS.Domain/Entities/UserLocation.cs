namespace LoanMS.Domain.Entities;

// ── User Location (many-to-many) ────────────────────────────────────────────
// Confirmed real gap: User.LocationId is a single FK — a user could only
// ever be scoped to exactly one Location, unlike Sales/Operation Teams
// (TeamMember), which already correctly supported many-to-many. This table
// is the new source of truth for a user's FULL set of assigned Locations;
// User.LocationId is kept (not removed — avoids a breaking change to any
// existing single-location read-path) and is treated as this user's
// "primary" Location, always also present as one row here.
public class UserLocation : BaseEntity
{
    public int UserId { get; set; }
    public int LocationId { get; set; }

    public User User { get; set; } = null!;
    public Location Location { get; set; } = null!;
}
