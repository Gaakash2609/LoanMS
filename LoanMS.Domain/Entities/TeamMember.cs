using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Team Member ───────────────────────────────────────────────────────────────
public class TeamMember : BaseEntity
{
    public int TeamId { get; set; }
    public int UserId { get; set; }

    public Team Team { get; set; } = null!;
    public User User { get; set; } = null!;
}
