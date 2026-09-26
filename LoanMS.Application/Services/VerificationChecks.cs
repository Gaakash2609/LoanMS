using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;

namespace LoanMS.Application.Services;

/// <summary>
/// The recorded verification checks behind the Overview flags (Doc / Bank / ECS /
/// FI / NACH / Customer Agreement). Each check is a Timeline entry with a fixed
/// name — the same names the React actions and Vanilla's addTrackingEntry write —
/// and the flag is the server's record that the entry exists. Income is not here:
/// it is derived from IncomeVerificationService.
///
/// Stage windows are the stages where the UI offers the action:
///   • Bank / ECS — the CPA checks: WIP / Login (Draft, Submitted), plus Under
///     Review so an application moved to Underwriting before this rule existed
///     can still complete them (Offer entry needs them).
///   • FI report — Underwriting / Decision / Approved (FI button, efin-app.js:27431).
///   • Documents, NACH, Customer Agreement — any open stage: the Bank Details
///     "Disbursement Pre-Conditions" checklist offers them at every stage
///     (Vanilla _renderDisburseChecklist).
/// A held or closed application is frozen (no check can be recorded or undone).
/// </summary>
public static class VerificationChecks
{
    public sealed record Check(string EntryName, string Label, Func<Loan, bool> Get, Action<Loan, bool> Set,
        IReadOnlyCollection<LoanStatus> Stages);

    private static readonly LoanStatus[] Cpa = { LoanStatus.Draft, LoanStatus.Submitted, LoanStatus.UnderReview };
    private static readonly LoanStatus[] Fi = { LoanStatus.UnderReview, LoanStatus.Decision, LoanStatus.Approved };
    private static readonly LoanStatus[] AnyOpen =
    {
        LoanStatus.Draft, LoanStatus.Submitted, LoanStatus.UnderReview, LoanStatus.Offer,
        LoanStatus.Decision, LoanStatus.Approved, LoanStatus.Acceptance,
    };

    public static readonly Check Documents = new("EFIN — Documents", "Documents check",
        l => l.DocumentChecked, (l, v) => l.DocumentChecked = v, AnyOpen);
    public static readonly Check Bank = new("EFIN- Bank Details Check", "Bank details check",
        l => l.BankChecked, (l, v) => l.BankChecked = v, Cpa);
    public static readonly Check Ecs = new("EFIN-Charge", "ECS return check",
        l => l.EcsReturn, (l, v) => l.EcsReturn = v, Cpa);
    public static readonly Check FiReport = new("EFIN- FI report", "FI report",
        l => l.FiReportChecked, (l, v) => l.FiReportChecked = v, Fi);
    public static readonly Check Nach = new("EFIN-Nach", "NACH",
        l => l.NachDone, (l, v) => l.NachDone = v, AnyOpen);
    public static readonly Check Agreement = new("EFIN-Customer Agreement", "Customer agreement",
        l => l.CustomerAgreementDone, (l, v) => l.CustomerAgreementDone = v, AnyOpen);

    public static readonly IReadOnlyList<Check> All = new[] { Documents, Bank, Ecs, FiReport, Nach, Agreement };

    public static Check? ForEntry(string? entryName)
    {
        var n = (entryName ?? "").Trim();
        return All.FirstOrDefault(c => string.Equals(c.EntryName, n, StringComparison.Ordinal));
    }

    /// <summary>No check may be recorded or undone on a held or closed application.</summary>
    public static bool IsFrozen(LoanStatus s) =>
        s is LoanStatus.OnHold or LoanStatus.Disbursed or LoanStatus.Closed or LoanStatus.Rejected;

    public static string StageList(Check c) => string.Join(" / ", c.Stages.Select(s => s switch
    {
        LoanStatus.UnderReview => "Under Review",
        _ => s.ToString(),
    }));

    /// <summary>
    /// FI result on the recorded FI report entry (sub-note "Final Resi Address - X /
    /// Final Office Address - Y"). Only entries carrying these lines are the report;
    /// the follow-up system note shares the name but has no result lines.
    /// </summary>
    public static (string? Resi, string? Office) ParseFiResult(string? subNote)
    {
        if (string.IsNullOrWhiteSpace(subNote)) return (null, null);
        static string? Grab(string text, string label)
        {
            var m = System.Text.RegularExpressions.Regex.Match(text, label + @"\s*-\s*([^\r\n]+)",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);
            return m.Success ? m.Groups[1].Value.Trim() : null;
        }
        return (Grab(subNote, "Final Resi Address"), Grab(subNote, "Final Office Address"));
    }
}
