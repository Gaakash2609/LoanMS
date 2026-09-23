namespace LoanMS.Domain.Enums;

// ── Obligation Source ─────────────────────────────────────────────────────────
// WHERE a loan obligation (running liability) came from, so a credit reviewer can
// tell a hand-keyed row apart from one the system detected off a bank statement or
// a bureau file. Stored as a string via HasConversion, exactly like every other
// enum on the loan (Loan.Status, IncomeVerification.State, LoanObligation.Source),
// so adding a value later needs NO migration and never disturbs existing rows.
//
// Every legacy obligation (Vanilla's frontend-only OBLIGATIONS object, hand-typed
// on the Obligations tab) is <see cref="Manual"/> — the safe default the additive
// migration backfills onto existing rows.
public enum ObligationSource
{
    /// <summary>Hand-entered by a user on the Obligations tab (Vanilla's only source).</summary>
    Manual = 0,

    /// <summary>Auto-detected from a persisted Perfios bank statement's recurring
    /// EMI/mandate debits (ACH/NACH/ECS). Detection is deterministic and
    /// server-driven; unknown fields (outstanding/tenure/rate/lender) are left null
    /// rather than invented.</summary>
    BankStatement = 1,

    /// <summary>Imported from a credit bureau / CIBIL file. Kept future-ready — the
    /// existing Bureau/CIBIL file-import infrastructure may feed this later. No fake
    /// CIBIL API is implemented.</summary>
    Bureau = 2,

    /// <summary>Sourced from an uploaded supporting document (e.g. a sanction
    /// letter / statement of account) rather than a live feed.</summary>
    Document = 3,
}
