using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Tracking Entry ────────────────────────────────────────────────────────────
public class TrackingEntry : BaseEntity
{
    public int LoanId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Stage { get; set; } = string.Empty;
    public string AssignedUser { get; set; } = string.Empty;
    public string Status { get; set; } = "Pending";
    public string? Comment { get; set; }
    public string? SubNote { get; set; }
    public int CreatedByUserId { get; set; }

    public Loan Loan { get; set; } = null!;
    public User CreatedBy { get; set; } = null!;
}
