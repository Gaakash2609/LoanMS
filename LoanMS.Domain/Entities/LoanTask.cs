using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Task ──────────────────────────────────────────────────────────────────────
public class LoanTask : BaseEntity
{
    public int? LoanId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string Priority { get; set; } = "Medium";
    public bool IsCompleted { get; set; } = false;
    public DateTime? DueDate { get; set; }
    public int AssignedToUserId { get; set; }
    public int CreatedByUserId { get; set; }

    public Loan? Loan { get; set; }
    public User AssignedTo { get; set; } = null!;
    public User CreatedBy { get; set; } = null!;
}
