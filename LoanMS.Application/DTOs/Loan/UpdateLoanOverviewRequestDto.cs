namespace LoanMS.Application.DTOs;

/// <summary>
/// Partial update of the loan-detail Overview parity fields (Vanilla
/// efin-app.js:2479): InCred RM, Analytic Bank, and the five underwriting
/// verification flags (Doc/Income/Bank/ECS/FI Checked). Every field is
/// nullable so a caller can flip a single flag — e.g. the Bank Details Check
/// modal setting BankChecked=true — without clearing the rest.
/// </summary>
public class UpdateLoanOverviewRequestDto
{
    public string? IncredRmName { get; set; }
    public string? AnalyticBank { get; set; }
    public bool? DocumentChecked { get; set; }
    public bool? IncomeChecked { get; set; }
    public bool? BankChecked { get; set; }
    public bool? EcsReturn { get; set; }
    public bool? FiReportChecked { get; set; }

    // ── Disburse pre-checks (Vanilla nach_done / customer_agreement_done,
    // efin-app.js buildTimelineActionButtons: Disburse button only renders
    // when both are true, on top of status). Gated the same way as the
    // other five flags above. ──
    public bool? NachDone { get; set; }
    public bool? CustomerAgreementDone { get; set; }
}
