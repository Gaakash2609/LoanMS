namespace LoanMS.Domain.Enums;

// ── Obligation Verification Status ────────────────────────────────────────────
// The credit-review lifecycle of a single obligation, kept SEPARATE from its
// active/closed lifecycle (LoanObligation.IsClosed). Verification answers "has an
// authorized reviewer confirmed this liability is real?"; active/closed answers
// "is it still a live monthly burden?". Stored as a string via HasConversion.
//
// FOIR / repayment-capacity math counts an obligation's EMI as a live burden when
// it is NOT closed AND NOT <see cref="Rejected"/> — verification status does not
// silence a real, unrejected EMI (an unverified but genuine EMI still burdens the
// borrower), it only tells the reviewer how much to trust the row.
public enum ObligationVerificationStatus
{
    /// <summary>Recorded but not yet reviewed. The safe default the additive
    /// migration backfills onto every existing (legacy manual) row.</summary>
    Unverified = 0,

    /// <summary>Needs a human to confirm — the default for auto-detected rows and
    /// for any row whose sources disagree (reconciliation mismatch).</summary>
    ReviewRequired = 1,

    /// <summary>An authorized reviewer confirmed this obligation is real and its
    /// figures are trusted.</summary>
    Verified = 2,

    /// <summary>An authorized reviewer determined this is not a genuine live
    /// obligation (e.g. a false-positive detection, or a duplicate). Excluded from
    /// FOIR — but the row is kept, never deleted, for audit.</summary>
    Rejected = 3,
}
