using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Loan Reference ────────────────────────────────────────────────────────────
public class LoanReference : BaseEntity
{
    public int    LoanId       { get; set; }
    public string Name         { get; set; } = string.Empty;
    public string Mobile       { get; set; } = string.Empty;
    public string Relation     { get; set; } = string.Empty;
    public int    RefNumber    { get; set; } = 1; // 1 or 2

    public Loan Loan { get; set; } = null!;
}
