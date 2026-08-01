using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Loan Document ─────────────────────────────────────────────────────────────
public class LoanDocument : BaseEntity
{
    public int LoanId { get; set; }
    public string DocumentName { get; set; } = string.Empty;
    public string DocumentType { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public long FileSizeBytes { get; set; }
    public string UploadedByUserId { get; set; } = string.Empty;

    // Navigation
    public Loan Loan { get; set; } = null!;
}
