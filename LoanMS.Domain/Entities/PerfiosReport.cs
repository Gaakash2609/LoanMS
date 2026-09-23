namespace LoanMS.Domain.Entities;

// ── Perfios Report ────────────────────────────────────────────────────────────
// Bank-statement verification result (salary/transaction analysis run
// entirely client-side by the Perfios module — see perfios-renderer.js's
// pfv9ConfirmAttachment). Was never persisted anywhere before this — the
// result lived only in a JS variable (window._perfiosBankDoc) and vanished
// on refresh or when viewed from a different device/session. This stores
// just the summary fields the UI actually displays/relies on, not every
// individual parsed transaction row (the source PDF itself is already
// separately saved through the normal document-upload flow).
//
// KNOWN ARCHITECTURAL LIMITATION (documented, not changed, as of Phase
// 7B-2): this table is keyed by LoanId ONLY — there is no column linking a
// row to the specific doc-item/document (own bank statement vs a
// co-applicant's vs a current-account statement) it was verified for. This
// mirrors legacy's own persistence contract (perfios-renderer.js's
// pfv9ConfirmAttachment POSTs the same shape, with no doc-item id either),
// so it is not a regression introduced by the wizard's multi-instance
// Perfios support (Phase 7B-2) — the frontend can now run Perfios
// independently per doc-item and holds each result in its own client-side
// state (see NewApplicationPage's perfiosResults/perfiosSavedKeysRef), but
// PerfiosController.GetLatest can still only ever return the single
// most-recently-verified report for the whole loan. On draft resume the
// frontend recovers at most one doc-item's badge by matching that report's
// FileName back to a restored document's name — if two different
// bank-statement docs were verified in an earlier session, only the newer
// one's status is recoverable this way. Distinguishing reports per doc-item
// would require a schema change (e.g. a DocumentId/DocItemKey column) —
// deliberately out of scope for 7B-2 per its instructions, and left for a
// future phase if per-document history becomes a real requirement.
public class PerfiosReport : BaseEntity
{
    public int LoanId { get; set; }
    public string? FileName { get; set; }
    /// <summary>Average Bank Balance — kept as a string since the frontend already formats/labels this (e.g. currency-formatted), not a raw number.</summary>
    public string? AverageBankBalance { get; set; }
    public string? Span { get; set; }
    public int? TotalTransactions { get; set; }
    public bool HasSalary { get; set; }
    public bool IsValid { get; set; }
    public string? FirstTransactionDate { get; set; }
    public string? LastTransactionDate { get; set; }
    public bool ManualReviewRequired { get; set; }
    public int? StaleDays { get; set; }
    public DateTime VerifiedAt { get; set; }

    // ── Gap-1: bank-evidence authority ──────────────────────────────────────────
    /// <summary>Trust level of this bank evidence: "ClientParsed" (browser-parsed —
    /// UNTRUSTED: it can NEVER drive AutoVerified; income verification is forced to
    /// ManualReviewRequired) or "ServerParsed" (server-authoritative). No genuine
    /// server-authoritative producer exists yet, so every current/legacy report is
    /// "ClientParsed". Never set to "ServerParsed" unless the transactions are truly
    /// server-derived and independently trusted.</summary>
    public string EvidenceSource { get; set; } = "ClientParsed";

    /// <summary>The actual uploaded bank-statement <see cref="LoanDocument"/> this
    /// report is bound to (ties the report to real evidence). Null when it could
    /// not be resolved. Resolved + hashed server-side, not trusted from the client.</summary>
    public int? BankStatementDocumentId { get; set; }

    /// <summary>Server-computed SHA-256 of the bound document's bytes (integrity /
    /// tamper-evidence). Null when the document/bytes were unavailable.</summary>
    public string? SourcePdfHash { get; set; }

    public LoanDocument? BankStatementDocument { get; set; }

    /// <summary>
    /// Complete Perfios analysis result serialized as JSON (dates encoded as
    /// epoch-ms). Lets Reports > Perfios Report re-hydrate the ENTIRE report
    /// from the backend after a refresh / on another device — every parsed
    /// transaction, the category buckets, the ABB month grid, validation
    /// checks and account header — exactly as the live analysis showed it.
    /// Previously only the summary columns above were stored, so the full
    /// report vanished on refresh; this closes that gap. Nullable for
    /// backward-compat with rows saved before full-report persistence
    /// existed (those still render from the summary columns).
    /// </summary>
    public string? ReportDataJson { get; set; }

    public Loan Loan { get; set; } = null!;
}
