namespace LoanMS.Application.IncomeVerification;

// ── Normalized bank statement (Phase 3 — trusted bank input) ──────────────────
// The server-side, structured view of a persisted PerfiosReport.ReportDataJson.
// This is what the Phase 4 verification engine matches salary slips against —
// derived ENTIRELY from the backend-persisted report, NEVER from window.* /
// client state (Phase 1 vuln S3). It mirrors the fields Vanilla _crossVerifySalary
// consumed (salary + NEFT/RTGS credits) plus the ownership/coverage/traceability
// the spec (§6/§7/§8/§9) requires, without building a parallel Perfios system —
// it just parses the report the frontend already saves.
public sealed class NormalizedBankStatement
{
    /// <summary>The PerfiosReport row this was parsed from.</summary>
    public int? SourcePerfiosReportId { get; set; }

    // ── Account header (for §6 ownership tracing) ───────────────────────────────
    public string? Bank { get; set; }
    public string? AccountNo { get; set; }
    public string? Ifsc { get; set; }
    public string? HolderName { get; set; }
    public string? Pan { get; set; }

    // ── §9 / §26(c) statement coverage ──────────────────────────────────────────
    /// <summary>Statement coverage start — from accountInfo.periodFrom when present
    /// (preferred), else the earliest transaction date.</summary>
    public DateTime? CoverageStart { get; set; }
    /// <summary>Statement coverage end — from accountInfo.periodTo when present
    /// (preferred), else the latest transaction date.</summary>
    public DateTime? CoverageEnd { get; set; }
    /// <summary>"StatementPeriod" (true coverage metadata was present) |
    /// "TransactionDates" (only min/max txn dates available — a limitation, not a
    /// guarantee the statement actually covered the whole span) | "None".</summary>
    public string CoverageSource { get; set; } = "None";

    /// <summary>True when the report itself flagged a manual-review condition
    /// (e.g. stale statement) — carried through, not re-decided here.</summary>
    public bool ReportManualReviewRequired { get; set; }

    /// <summary>Gap-1: whether this bank evidence is server-authoritative
    /// ("ServerParsed"). When false (client-parsed), the engine can NEVER
    /// AutoVerify — it forces ManualReviewRequired. Set by the caller from
    /// PerfiosReport.EvidenceSource; the normalizer never trusts the client.</summary>
    public bool IsTrustedEvidence { get; set; }

    /// <summary>Salary-credit candidates (Perfios "Salary" + "NEFT/RTGS" sections,
    /// credits only) — the exact source set Vanilla used.</summary>
    public List<NormalizedTransaction> SalaryCreditCandidates { get; set; } = new();
}

public sealed class NormalizedTransaction
{
    public DateTime Date { get; set; }
    /// <summary>Original epoch-ms as stored, kept so the engine can resolve any
    /// timezone/day-boundary question against the exact stored value.</summary>
    public long DateEpochMs { get; set; }
    public decimal Amount { get; set; }
    public string Desc { get; set; } = string.Empty;
    public string RawDesc { get; set; } = string.Empty;
    /// <summary>"CR" | "DR" (candidates are always "CR").</summary>
    public string Type { get; set; } = string.Empty;
    public string? Category { get; set; }
    /// <summary>"Salary" | "NEFT" — which section the credit came from.</summary>
    public string Section { get; set; } = string.Empty;

    // ── §8 signals (existing narration heuristic only — NOT invented) ───────────
    /// <summary>True when the narration matches the SAME return/reversal signal
    /// legacy already uses (perfios-renderer isBad = /return|reversal/i, analysis
    /// NEFT return = /return|reject/i). Surfaced for the engine to decide on;
    /// there is NO per-transaction reversal metadata in the source data, so this
    /// is a heuristic flag, not an authoritative classification (§8/§25).</summary>
    public bool IsPossibleReturnOrReversal { get; set; }
}
