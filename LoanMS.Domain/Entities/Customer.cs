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
    /// <summary>One of InCred's RESIDENCE_TYPE enum values (optional on their side).
    /// Rendered as the current-address "Home Type" in the loan-detail Address tab.</summary>
    public string? ResidenceType { get; set; }

    // ── Applicant-tab parity fields (added 2026-09-05, user-authorised) ──────
    // Mirrors the VanillaJS loan-detail applicant tabs (efin-app.js:2537 personal,
    // 2569/2579 current+permanent address, 2601/2661 employment). Previously
    // React had no column, DTO field or form input for these, so the tabs
    // could not show or edit them.
    /// <summary>Personal tab — Mother's name (KYC).</summary>
    public string? MotherName { get; set; }
    /// <summary>Personal tab — secondary contact number.</summary>
    public string? AlternatePhone { get; set; }
    /// <summary>Current address — house / flat no. (Address holds street &amp; locality.)</summary>
    public string? HouseNo { get; set; }
    // Permanent address block — separate from the current address above.
    public string? PermanentHouseNo { get; set; }
    public string? PermanentAddress { get; set; }
    public string? PermanentCity { get; set; }
    public string? PermanentState { get; set; }
    public string? PermanentPinCode { get; set; }
    public string? PermanentResidenceType { get; set; }
    // Employment tab extras.
    public string? Designation { get; set; }
    public string? CompanyType { get; set; }
    public string? OfficialEmail { get; set; }
    public string? OfficeAddress { get; set; }
    public string? OfficePinCode { get; set; }

    // Navigation
    public ICollection<Loan> Loans { get; set; } = new List<Loan>();
}
