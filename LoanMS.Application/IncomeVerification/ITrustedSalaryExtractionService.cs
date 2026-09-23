namespace LoanMS.Application.IncomeVerification;

/// <summary>
/// §26(a): re-derives the ORIGINAL Net Salary from an uploaded salary-slip
/// document SERVER-SIDE (fetch from storage → AI-vision for images → parse with
/// the same canonical rules the client uses), so the trusted original never
/// depends on a client-posted number. When server-side extraction is not
/// possible (AI vision disabled/unavailable, or a non-image document the server
/// cannot read), it returns an UNTRUSTED result — the caller then stores the
/// client value as ClientReported and the verification is forced to
/// ManualReviewRequired. Never throws for a normal "couldn't read it" outcome.
/// </summary>
public interface ITrustedSalaryExtractionService
{
    /// <param name="storageKey">LoanDocument.FilePath (the storage key).</param>
    /// <param name="contentTypeHint">Optional MIME hint (e.g. from the document row).</param>
    Task<TrustedSalaryExtractionResult> ExtractAsync(
        string storageKey, string? contentTypeHint = null, CancellationToken ct = default);
}

public sealed class TrustedSalaryExtractionResult
{
    /// <summary>True only when the net came from an authoritative server-side
    /// extraction (IsTrustedOriginal). False → treat as ClientReportedOriginal.</summary>
    public bool IsTrusted { get; set; }

    /// <summary>"ServerVision" | "ServerText" | "ClientReported" (unavailable).</summary>
    public string ExtractionMethod { get; set; } = "ClientReported";

    public decimal? OriginalNetSalary { get; set; }
    public decimal? Gross { get; set; }
    public string? MonthLabel { get; set; }

    /// <summary>SHA-256 of the document bytes (duplicate/§26f + snapshot support).
    /// Null when the bytes could not be read.</summary>
    public string? ContentHash { get; set; }

    /// <summary>Human-readable reason when extraction fell back to untrusted.</summary>
    public string? FallbackReason { get; set; }
}
