namespace LoanMS.Application.DTOs;

public class PerfiosReportDto
{
    public int Id { get; set; }
    public string? FileName { get; set; }
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
    /// <summary>Complete report payload as JSON (see PerfiosReport.ReportDataJson). Null for legacy summary-only rows.</summary>
    public string? ReportDataJson { get; set; }
}

public class SavePerfiosReportRequestDto
{
    public string? FileName { get; set; }
    public string? AverageBankBalance { get; set; }
    public string? Span { get; set; }
    public int? TotalTransactions { get; set; }
    public bool HasSalary { get; set; }
    public bool IsValid { get; set; }
    public string? FirstTransactionDate { get; set; }
    public string? LastTransactionDate { get; set; }
    public bool ManualReviewRequired { get; set; }
    public int? StaleDays { get; set; }
    /// <summary>Complete report payload as JSON so the whole report (not just the summary) can be reloaded later.</summary>
    public string? ReportDataJson { get; set; }
    /// <summary>Gap-1: the uploaded bank-statement document this report was derived
    /// from. Optional — when omitted the server best-effort resolves it by file name.
    /// The report's trust level (EvidenceSource) is set server-side, never here.</summary>
    public int? BankStatementDocumentId { get; set; }
}
