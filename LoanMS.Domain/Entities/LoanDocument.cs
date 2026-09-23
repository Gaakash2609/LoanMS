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

    // ── Gap-2: authoritative applicant identity of this document ────────────────
    /// <summary>Whose document this is: primary Applicant (default) or CoApplicant.
    /// Makes the SOURCE document — not the verification run's order — the authority
    /// for applicant isolation. Stored as a string (HasConversion), matching the
    /// SalarySlipExtraction/IncomeVerification convention. Existing rows default to
    /// Applicant (single-applicant behavior preserved).</summary>
    public ApplicantRole ApplicantRole { get; set; } = ApplicantRole.Applicant;
    /// <summary>Stable identifier of the applicant within the loan (null for the
    /// primary; a co-applicant key when multiple exist). Single co-applicant → null.</summary>
    public string? ApplicantKey { get; set; }

    // ── Phase 2 RBAC — G-10 / G-11 document verification & versioning ──────────
    /// <summary>Review state: "Pending" (default, on upload), "Verified", or
    /// "Rejected". Kept as a plain string (not an enum) to match the string-
    /// status convention already used across this codebase (Loan.Status,
    /// PayoutClaim.Status) and so the additive migration needs no enum mapping.
    /// Every pre-existing row defaults to "Pending".</summary>
    public string Status { get; set; } = "Pending";
    /// <summary>Verifier's note, or the mandatory reason when Status ==
    /// "Rejected". Null while Pending.</summary>
    public string? ReviewNote { get; set; }
    /// <summary>User id (string, mirrors UploadedByUserId) of whoever verified/
    /// rejected the document. Null while Pending.</summary>
    public string? ReviewedByUserId { get; set; }
    /// <summary>When the verify/reject decision was made. Null while Pending.</summary>
    public DateTime? ReviewedAt { get; set; }

    /// <summary>1-based version. A "Replace" uploads a new document whose
    /// Version is the superseded document's Version + 1, preserving history.</summary>
    public int Version { get; set; } = 1;
    /// <summary>When this document was replaced, points to the LoanDocument that
    /// superseded it (this row is then soft-deleted). Null for a live document.</summary>
    public int? SupersededByDocumentId { get; set; }

    // Navigation
    public Loan Loan { get; set; } = null!;
}
