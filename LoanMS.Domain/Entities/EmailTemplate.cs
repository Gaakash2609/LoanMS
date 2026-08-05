namespace LoanMS.Domain.Entities;

// ── Email Templates (Settings → Templates) ───────────────────────────────
/// <summary>
/// Admin-customized subject/body override for an auto-sent system email
/// (invitation, password reset, stage change, approval, disbursement,
/// rejection, document request, EMI reminder). Was frontend-only
/// (localStorage key 'efin_email_templates_v1') — customizations made by one
/// admin on one browser never applied anywhere else, including for
/// server-triggered auto-sends, which could only ever have used the
/// hardcoded defaults regardless of what an admin "saved" locally.
/// </summary>
public class EmailTemplate : BaseEntity
{
    /// <summary>Stable key: invitation | pwreset | stage | approval | disburse | rejection | docs | emi.</summary>
    public string TemplateKey { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
}
