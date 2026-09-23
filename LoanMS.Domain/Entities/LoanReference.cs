using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Loan Reference ────────────────────────────────────────────────────────────
public class LoanReference : BaseEntity
{
    public int    LoanId       { get; set; }
    public string Name         { get; set; } = string.Empty;
    public string Mobile       { get; set; } = string.Empty;
    public string Relation     { get; set; } = string.Empty;
    /// <summary>Reference's address — Vanilla's "Reference N — Address" row
    /// (efin-app.js references tab). Optional.</summary>
    public string? Address     { get; set; }
    public int    RefNumber    { get; set; } = 1; // 1 or 2

    public Loan Loan { get; set; } = null!;
}
