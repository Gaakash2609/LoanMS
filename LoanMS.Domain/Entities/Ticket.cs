using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Ticket ────────────────────────────────────────────────────────────────────
public class Ticket : BaseEntity
{
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Status { get; set; } = "Open";
    public string Priority { get; set; } = "Medium";
    public int? LoanId { get; set; }
    public int CreatedByUserId { get; set; }
    public int? AssignedToUserId { get; set; }
    public DateTime? ClosedAt { get; set; }

    public Loan? Loan { get; set; }
    public User CreatedBy { get; set; } = null!;
    public User? AssignedTo { get; set; }
}
