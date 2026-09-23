using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Salary Slip Extraction (immutable original + separate override) ───────────
// §4 / §26(a) / §26(e): the CRITICAL security record. The original extracted Net
// Salary is written ONCE and never overwritten. A user edit is stored in a
// SEPARATE field with a reason + who + when, and the mere presence of an
// override forces the verification to ManualReviewRequired (an edit can never
// silently become the trusted salary). Today the React modal edits netPay in
// place (SalarySlipExtractionModal.tsx:202-203) with no original preserved —
// this entity closes that hole once the flows are wired (Phases 3/6).
public class SalarySlipExtraction : BaseEntity
{
    public int LoanId { get; set; }

    /// <summary>The uploaded salary-slip document (S3) this came from, if linked.</summary>
    public int? DocumentId { get; set; }

    // ── §6 applicant isolation ────────────────────────────────────────────────
    public ApplicantRole ApplicantRole { get; set; } = ApplicantRole.Applicant;
    public string? ApplicantKey { get; set; }

    // ── Detected month ──────────────────────────────────────────────────────────
    public int? Year { get; set; }
    public int? Month { get; set; }
    public string? MonthLabel { get; set; }

    // ── Immutable original ──────────────────────────────────────────────────────
    /// <summary>The trusted extracted Net Salary. Set exactly once; never updated.</summary>
    public decimal? OriginalNetSalary { get; set; }
    /// <summary>"ServerVision" (re-extracted server-side from S3 — trusted) |
    /// "ClientReported" (client value — untrusted, forces ManualReviewRequired
    /// per §26(a)) | "ClientText".</summary>
    public string ExtractionMethod { get; set; } = "ClientReported";
    /// <summary>True only when OriginalNetSalary came from an authoritative
    /// server-side extraction. False → treat original as ClientReportedOriginal.</summary>
    public bool IsTrustedOriginal { get; set; }

    // ── Separate user override (never overwrites the original) ──────────────────
    public decimal? UserEditedSalary { get; set; }
    public string? OverrideReason { get; set; }
    public int? EditedByUserId { get; set; }
    public DateTime? EditedAt { get; set; }

    // ── §26(f)/(k): content identity for duplicate + snapshot ───────────────────
    /// <summary>Hash of the uploaded file content — lets identical re-uploads be
    /// detected and duplicate same-month slips be flagged, without silently
    /// discarding any slip (all rows persist and are auditable).</summary>
    public string? ContentHash { get; set; }

    // Navigation
    public Loan Loan { get; set; } = null!;
}
