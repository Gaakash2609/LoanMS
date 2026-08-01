using LoanMS.Domain.Enums;

namespace LoanMS.Domain.Entities;

// ── Payout Rule ───────────────────────────────────────────────────────────────
public class PayoutRule : BaseEntity
{
    public string  LoanType    { get; set; } = string.Empty; // personal_loan|business_loan|home_loan etc
    public decimal Percentage  { get; set; } = 1.0m;         // % of approved/disbursed amount
    public decimal? MinPayout  { get; set; }                  // Minimum payout amount
    public decimal? MaxPayout  { get; set; }                  // Maximum payout cap
    public bool    IsActive    { get; set; } = true;
    public string? Notes       { get; set; }
}
