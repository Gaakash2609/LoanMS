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
}
