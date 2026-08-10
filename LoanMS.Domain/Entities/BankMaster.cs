using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Bank Master (Phase 5B) ──────────────────────────────────────────────────
/// <summary>
/// Master list of lender/partner banks (RM contact + IFSC prefix + emp code)
/// managed from the Banks screen. Standalone master data — not currently
/// referenced by Loan/Customer/Payout via foreign key, so no existing
/// relationships are affected by this addition.
/// </summary>
public class BankMaster : BaseEntity
{
    public string  BankName    { get; set; } = string.Empty;
    public string? IfscPrefix  { get; set; }
    public string? EmpCode     { get; set; }
    public string? Location    { get; set; }
    public string? RmName      { get; set; }
    public string? RmMobile    { get; set; }
    public string? Email       { get; set; }
    public string? Remarks     { get; set; }
    public bool    IsActive    { get; set; } = true;

    /// <summary>User who created this bank record (for audit; not used for ownership checks).</summary>
    public int? CreatedByUserId { get; set; }

    // ── Lender Configuration — eligibility engine (Loan Analytics / Wizard
    // Step 9 bank-matching) — added so the Lender Configuration screen and
    // Step 9's laLoadEligibility() are no longer LA_DB-only, browser-memory,
    // non-persistent config. Mirrors the LA_DB.banks[].rules shape from
    // efin-app.js exactly, so the frontend sync layer (_syncAnalyticBanks in
    // api-bridge.js) can map this straight onto LA_DB without reshaping.
    public bool    IsIncred        { get; set; }
    public bool    IsElite         { get; set; }
    public int     MinCibil        { get; set; } = 700;
    public bool    AcceptNtc       { get; set; }
    public decimal MaxLoanAmt      { get; set; } = 5000000;
    public int     MinTenure       { get; set; } = 12;
    public int     MaxTenure       { get; set; } = 60;
    public int     FoirLimit       { get; set; } = 50;
    public bool    PfRequired      { get; set; }
    public int     MinAge          { get; set; } = 21;
    public int     MaxAge          { get; set; } = 60;
    public int     MinExpMonths    { get; set; } = 6;
    /// <summary>JSON string array, e.g. ["SALARIED","SELFEMP"] — same values the frontend already uses.</summary>
    public string  EmpTypesJson    { get; set; } = "[]";
    /// <summary>JSON string array, e.g. ["plcc","plc","llp"] — same values the frontend already uses.</summary>
    public string  CompTypesJson   { get; set; } = "[]";

    public ICollection<BankEligibilityLine> Lines { get; set; } = new List<BankEligibilityLine>();
}
