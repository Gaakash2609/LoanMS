using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Team ──────────────────────────────────────────────────────────────────────
public class Team : BaseEntity
{
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = "Sales";  // Sales | Login
    public int? LocationId { get; set; }
    public int? TeamLeadUserId { get; set; }

    public Location? Location { get; set; }
    public User? TeamLead { get; set; }
    public ICollection<TeamMember> Members { get; set; } = new List<TeamMember>();
}
