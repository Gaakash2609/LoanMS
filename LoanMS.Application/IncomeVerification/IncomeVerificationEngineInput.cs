using LoanMS.Domain.Enums;

namespace LoanMS.Application.IncomeVerification;

// ── Engine input (Phase 4) ────────────────────────────────────────────────────
// All the TRUSTED, backend-sourced facts the engine needs. Assembled by Phase 5
// (from the persisted loan, PerfiosReport → NormalizedBankStatement, and
// SalarySlipExtraction rows). The engine reads nothing else — no client state.
public sealed class IncomeVerificationEngineInput
{
    public int LoanId { get; init; }
    public ApplicantRole ApplicantRole { get; init; } = ApplicantRole.Applicant;
    public string? ApplicantKey { get; init; }

    /// <summary>§26(b) persisted canonical date the required months derive from.</summary>
    public DateTime RequiredMonthsReferenceDate { get; init; }

    /// <summary>Declared income snapshot (Customer.MonthlyIncome) — for the §5
    /// declared-vs-verified discrepancy note. Never becomes verified income.</summary>
    public decimal? DeclaredIncome { get; init; }

    /// <summary>The trusted bank statement (null ⇒ MissingBankStatement).</summary>
    public NormalizedBankStatement? Statement { get; init; }

    /// <summary>All salary slips for THIS applicant (isolation already applied by
    /// the caller). Multiple slips for the same month trigger DuplicateSalarySlipMonth.</summary>
    public IReadOnlyList<EngineSlip> Slips { get; init; } = new List<EngineSlip>();

    public int RunByUserId { get; init; }
    public DateTime RunAt { get; init; } = DateTime.UtcNow;
    public int? PerfiosReportId { get; init; }
    public string? SourceReportHash { get; init; }
    public string? IdempotencyKey { get; init; }
}

public sealed class EngineSlip
{
    public int? ExtractionId { get; init; }
    public int Year { get; init; }
    public int Month { get; init; }   // 1-based
    /// <summary>Immutable server/original net. Null when not extracted.</summary>
    public decimal? OriginalNetSalary { get; init; }
    /// <summary>Separate user override (never overwrites original). Present ⇒ manual review.</summary>
    public decimal? UserEditedSalary { get; init; }
    /// <summary>False ⇒ ClientReported original ⇒ manual review (§26a).</summary>
    public bool IsTrustedOriginal { get; init; }

    /// <summary>Salary used for matching: override when present, else original (§4/§5).</summary>
    public decimal? EffectiveSalary => UserEditedSalary ?? OriginalNetSalary;
    public bool HasOverride => UserEditedSalary is not null;
}
