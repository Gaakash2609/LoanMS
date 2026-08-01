using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Loan Status History ───────────────────────────────────────────────────────
public class LoanStatusHistory : BaseEntity
{
    public int LoanId { get; set; }
    public LoanStatus FromStatus { get; set; }
    public LoanStatus ToStatus { get; set; }
    public string? Comment { get; set; }
    public int ChangedByUserId { get; set; }

    public Loan Loan { get; set; } = null!;
    public User ChangedBy { get; set; } = null!;
}
