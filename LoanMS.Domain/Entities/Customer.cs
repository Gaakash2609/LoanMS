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

    // ── Normalised identity keys (global customer identification) ────────────
    // Derived values, never user input: RefreshIdentityKeys() recomputes them
    // from PanNumber / Phone / Email, and AppDbContext calls it for every added
    // or modified Customer on SaveChanges, so every write path keeps them in
    // step. Customer matching runs on these indexed columns instead of the raw
    // values, which legacy rows store in mixed formats (+91 / spaces / case).
    // PanNormalized carries the unique guarantee for the customer-create race.
    public string? PanNormalized { get; set; }
    public string? PhoneNormalized { get; set; }
    public string? EmailNormalized { get; set; }

    // Navigation
    public ICollection<Loan> Loans { get; set; } = new List<Loan>();

    public void RefreshIdentityKeys()
    {
        PanNormalized   = NormalizePan(PanNumber);
        PhoneNormalized = NormalizeMobile(Phone);
        EmailNormalized = NormalizeEmail(Email);
    }

    /// <summary>PAN: trim + uppercase. Only a complete, well-formed PAN
    /// (ABCDE1234F) identifies a customer — a half-typed autosave value must
    /// never match, or collide with, somebody else.</summary>
    public static string? NormalizePan(string? pan)
    {
        var p = pan?.Trim().ToUpperInvariant();
        if (string.IsNullOrEmpty(p) || p.Length != 10) return null;
        for (var i = 0; i < 10; i++)
        {
            var ok = i is >= 5 and <= 8 ? char.IsAsciiDigit(p[i]) : char.IsAsciiLetterUpper(p[i]);
            if (!ok) return null;
        }
        return p;
    }

    /// <summary>Mobile: digits only, last 10 digits (drops +91 / 0 / spaces /
    /// dashes). Fewer than 10 digits is not an identifier.</summary>
    public static string? NormalizeMobile(string? mobile)
    {
        if (string.IsNullOrWhiteSpace(mobile)) return null;
        var digits = new string(mobile.Where(char.IsAsciiDigit).ToArray());
        return digits.Length >= 10 ? digits[^10..] : null;
    }

    /// <summary>Email: trim + lowercase. The wizard's system placeholders
    /// (<c>…@efin.auto</c>) are not real addresses and never identify anyone.</summary>
    public static string? NormalizeEmail(string? email)
    {
        var e = email?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(e) || !e.Contains('@') || e.EndsWith("@efin.auto", StringComparison.Ordinal))
            return null;
        return e;
    }
}
