namespace LoanMS.Domain.Enums;

// ── Income Verification State ─────────────────────────────────────────────────
// Authoritative lifecycle of a single applicant's salary/income verification.
// Persisted as a STRING (HasConversion<string>) to stay readable in the DB and
// avoid the enum-int migration fragility other new columns in this codebase
// deliberately sidestep (see LoanDocument.Status's doc comment).
//
// Phase 1 audit → Phase 2 data foundation. The engine that DERIVES these states
// (Vanilla-equivalent _crossVerifySalary) lands in Phase 4; this enum only
// defines the vocabulary the persistence layer stores.
public enum IncomeVerificationState
{
    /// <summary>No authoritative verification has run yet.</summary>
    Pending,

    /// <summary>Backend engine matched every required month exactly — trusted.</summary>
    AutoVerified,

    /// <summary>Automatic verification could not silently pass (mismatch, manual
    /// salary override, untrusted original, duplicate slip, etc.) — a human
    /// reviewer must decide. Never silently upgraded to AutoVerified.</summary>
    ManualReviewRequired,

    /// <summary>An authorized reviewer completed the manual review (approve/reject
    /// recorded with reviewer + timestamp + reason).</summary>
    ManualReviewCompleted,

    /// <summary>Automatic verification failed and was not routed to manual review
    /// (e.g. missing evidence that blocks progression).</summary>
    Failed,

    /// <summary>§26(d): a pre-existing loan whose legacy client-controlled
    /// Loan.IncomeChecked=true was migrated in. NOT proof of a fresh backend
    /// verification — downstream (Eligibility/FOIR/CAM) must treat it as
    /// unverified until a real backend run occurs.</summary>
    LegacyUnverified
}
