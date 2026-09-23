namespace LoanMS.Domain.Enums;

// ── Income Verification Reason Codes ──────────────────────────────────────────
// §12 of the spec. Structured reasons a verification (or a single month) carries.
// Persisted as strings. Phase 2 only DEFINES the vocabulary — a code is only
// ever EMITTED by Phase 4's engine where an implemented rule supports it (the
// spec forbids emitting a reason for a rule that does not exist).
public enum IncomeVerificationReason
{
    None,

    // Amount / month / window (all backed by Vanilla _crossVerifySalary rules)
    SalaryAmountMismatch,     // credit found in window, amount != slip net (exact Math.round compare)
    SalaryMonthMismatch,      // slip month does not correspond to a required month
    TransactionOutsideWindow, // candidate credit exists but outside 20th → next-15th window
    MissingStatementCoverage, // §26(c): statement does not cover the required period (BRG-1 default)
    DuplicateTransaction,     // §8: same credit represented/imported twice
    ReversalTransaction,      // §8: reversed/refunded credit — not an independent salary credit
    ApplicantMismatch,        // §6: evidence belongs to a different applicant/co-applicant

    // Slip / override / declared
    ManualSalaryOverride,     // §4/§26(e): user-edited net differs from immutable original
    DeclaredIncomeMismatch,   // §5: declared vs verified differ (surfaced, NOT auto-failed on a % — BRG-2)
    MissingSalarySlip,        // required month has no slip
    MissingBankStatement,     // no Perfios/bank statement to validate credits
    DuplicateSalarySlipMonth  // §26(f): >1 slip for same applicant+month → manual review
}
