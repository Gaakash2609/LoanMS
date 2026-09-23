using LoanMS.Domain.Enums;
using System.ComponentModel.DataAnnotations;

namespace LoanMS.Application.DTOs;

public class LoanListDto
{
    public int Id { get; set; }
    public string LoanNumber { get; set; } = string.Empty;
    public string LoanType { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public decimal RequestedAmount { get; set; }
    public decimal? ApprovedAmount { get; set; }
    public decimal InterestRate { get; set; }
    public int TenureMonths { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string CustomerPhone { get; set; } = string.Empty;
    public string CreatedByName { get; set; } = string.Empty;
    public string? AssignedToName { get; set; }
    public string? LoginUserName { get; set; }
    // Productivity audit (P1) — surfaces the customer's latest bureau risk
    // grade (already computed and persisted on BureauReport when a report
    // is generated — see CibilAnalysisService.GetRiskGrade — this reads
    // the existing stored value, doesn't recompute anything) so it's
    // visible for sort/filter/triage on the Applications list instead of
    // being buried inside each application's CIBIL tab.
    public string? RiskGrade { get; set; }
    /// <summary>
    /// The customer's stored bureau score. Added for the Applications →
    /// Advanced Filter CIBIL band control, which filters on the numeric score
    /// (300-549 / 550-649 / 650-749 / 750-900) and cannot use RiskGrade above,
    /// that being a letter grade derived from score + risk factors. Reads the
    /// existing Customer.CibilScore column — no new storage, and Customer is
    /// already joined by this projection for CustomerName/CustomerPhone.
    /// </summary>
    public int? CustomerCibilScore { get; set; }

    // ── Applications → Advanced Filter ─────────────────────────────────
    // The legacy filter panel narrows on these too. Every one is an existing
    // column on an entity this projection already reaches (Loan itself, its
    // Customer, or the Location/Dsa/Partner navigations) — no new storage and
    // no migration, they were simply never surfaced on the list payload, so
    // the React list had nothing to filter by.
    public string? LocationName { get; set; }
    public string? Purpose { get; set; }
    /// <summary>
    /// Carries the wizard's Source/Channel/Lead-Source text. The wizard writes
    /// them into Remarks as "Source: x | Channel: y" rather than into columns,
    /// and WizardController.GetDraft already parses them back out the same way
    /// — this exposes the raw string so the list can do likewise.
    /// </summary>
    public string? Remarks { get; set; }
    /// <summary>Lender chosen in the wizard (Loan.SelectedLenderNames).</summary>
    public string? SelectedLenderNames { get; set; }
    public string? DsaName { get; set; }
    public string? PartnerName { get; set; }
    public string? CustomerCity { get; set; }
    public string? CustomerState { get; set; }
    public string? CustomerGender { get; set; }
    public string? CustomerEmploymentType { get; set; }
    public string? CustomerCompanyName { get; set; }

    // ── Tasks page → Created / Assigned tabs ───────────────────────────
    // Legacy matches these two lists by *name* (_appCreatedBy(a) === uname),
    // which silently mis-buckets loans whenever two users share a display
    // name. The ids are already on the Loan row and are what the visibility
    // scope itself compares, so exposing them lets the client bucket exactly.
    // Existing columns, no migration.
    public int CreatedByUserId { get; set; }
    public int? AssignedToUserId { get; set; }
    public decimal? CustomerMonthlyIncome { get; set; }
    public DateTime CreatedAt { get; set; }
}
