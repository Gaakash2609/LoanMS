using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── DSA/Partner uploaded documents (KYC/onboarding docs) ───────────────────────
public class DsaDocument : BaseEntity
{
    public int DsaPartnerId { get; set; }
    public string DocumentName { get; set; } = string.Empty;
    public string DocumentType { get; set; } = string.Empty;
    public string FilePath { get; set; } = string.Empty;
    public long FileSizeBytes { get; set; }
    public string UploadedByUserId { get; set; } = string.Empty;

    // Navigation
    public DsaPartner DsaPartner { get; set; } = null!;
}
