using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Customer ──────────────────────────────────────────────────────────────────
public class Customer : BaseEntity
{
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string? PanNumber { get; set; }
    public string? AadhaarNumber { get; set; }
    public DateTime? DateOfBirth { get; set; }
    public string? Address { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? PinCode { get; set; }
    public decimal? MonthlyIncome { get; set; }
    /// <summary>Existing monthly EMI/debt obligations declared by the applicant — used for FOIR
    /// (Fixed Obligation to Income Ratio) calculations. Captured on the New Application wizard's
    /// Employment step (Phase 5A) and persisted server-side alongside MonthlyIncome.</summary>
    public decimal? MonthlyObligations { get; set; }
    public string? EmploymentType { get; set; }
    public string? CompanyName { get; set; }
    public int? CibilScore { get; set; }

    // ── KYC fields needed for InCred's application/init API ──────────────────
    /// <summary>"M" or "F" — InCred's application/init API requires this exact format.</summary>
    public string? Gender { get; set; }
    /// <summary>Optional on InCred's side (MNAME) but useful KYC data generally.</summary>
    public string? FatherName { get; set; }
    /// <summary>One of InCred's RESIDENCE_TYPE enum values (optional on their side).</summary>
    public string? ResidenceType { get; set; }

    // Navigation
    public ICollection<Loan> Loans { get; set; } = new List<Loan>();
}
