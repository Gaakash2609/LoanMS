namespace LoanMS.Domain.Entities;

// ── InCred RM Email (Relationship Manager directory used on InCred applications) ──
/// <summary>
/// Master list of InCred Relationship Manager contacts (name/location/email/
/// contact number), used to populate the RM selector shown on the loan wizard
/// and to tag InCred applications with PARTNER_DATA.RM_EMAIL. Previously this
/// list lived only in frontend memory (efin-app.js RM_EMAILS array) and was
/// lost on every page refresh / not shared across tabs or devices — this
/// entity is what makes it a real, database-backed master list.
/// </summary>
public class IncredRmEmail : BaseEntity
{
    public string  Name      { get; set; } = string.Empty;
    public string? Location  { get; set; }
    public string  Email     { get; set; } = string.Empty;
    public string? ContactNo { get; set; }
}
