namespace LoanMS.Domain.Entities;

// ── Loan Obligation (Running Loan / Bank Line) ──────────────────────────────
// Mirrors running_loan_bank_line.py — the per-application FOIR obligation
// rows shown on the loan detail "Obligations" tab. Previously frontend-only
// (efin-app.js `var OBLIGATIONS = {}`), persisted only to the browser's
// localStorage — data added on one browser/device never showed up on
// another. This entity is what makes it real, database-backed loan data.
public class LoanObligation : BaseEntity
{
    public int LoanApplicationId { get; set; }
    public string LoanType { get; set; } = string.Empty;
    public decimal SanctionAmount { get; set; }
    public string? FinancerName { get; set; }
    public decimal LoanEmi { get; set; }
    public decimal AmountOutstanding { get; set; }
    public DateTime? LoanClosureDate { get; set; }
    /// <summary>Loan account number (frontend: obl-accno / loan_acc_no).</summary>
    public string? LoanAccountNumber { get; set; }
    /// <summary>Marked for Balance Transfer (frontend: select_bt / toggleBT).</summary>
    public bool SelectBT { get; set; }

    // Navigation
    public Loan LoanApplication { get; set; } = null!;
}
