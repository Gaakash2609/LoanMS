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
}
