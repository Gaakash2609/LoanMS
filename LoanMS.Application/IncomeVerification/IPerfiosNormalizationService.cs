namespace LoanMS.Application.IncomeVerification;

/// <summary>
/// Parses a persisted PerfiosReport.ReportDataJson into a structured, server-side
/// <see cref="NormalizedBankStatement"/>. This is the ONLY door through which
/// bank/transaction evidence reaches the verification engine — the engine never
/// reads client state. Deterministic: the same JSON always yields the same
/// result, so a decision made against a snapshot (SourceReportHash) is reproducible.
/// </summary>
public interface IPerfiosNormalizationService
{
    /// <summary>Returns null when the JSON is absent/blank/corrupt (caller then
    /// treats bank evidence as missing → MissingBankStatement, not a crash).</summary>
    NormalizedBankStatement? Normalize(string? reportDataJson, int? sourcePerfiosReportId = null);

    /// <summary>Stable SHA-256 of the exact report JSON, for §26(k) snapshotting.</summary>
    string ComputeReportHash(string reportDataJson);
}
