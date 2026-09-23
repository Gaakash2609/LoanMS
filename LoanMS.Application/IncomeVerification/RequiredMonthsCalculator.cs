namespace LoanMS.Application.IncomeVerification;

// ── Required salary months (Phase 4) ──────────────────────────────────────────
// EXACT port of Vanilla ai-agent.js _incRequiredMonths (line 228):
//   recentBack = (day < 15) ? 2 : 1
//   for k = 2..0:  month = referenceMonth - recentBack - k   (oldest → newest)
// i.e. 3 rolling months. The ONLY change from Vanilla is the source of the
// reference date: Vanilla uses the browser's `new Date()` (so a re-run drifts);
// here the caller passes the PERSISTED RequiredMonthsReferenceDate (§26b:
// submit date preferred, else loan CreatedAt), so re-running never changes the
// required months. "3" is NOT hard-coded as policy — it is the count Vanilla's
// own rule produces, preserved verbatim.
public static class RequiredMonthsCalculator
{
    private static readonly string[] Mon =
        { "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec" };

    public readonly record struct YearMonth(int Year, int Month); // Month is 1-based

    /// <summary>Returns the 3 required months oldest → newest.</summary>
    public static IReadOnlyList<YearMonth> Resolve(DateTime referenceDate)
    {
        int recentBack = referenceDate.Day < 15 ? 2 : 1;
        // newest = referenceMonth - recentBack (Vanilla k=0). Build via 1st-of-month
        // arithmetic to handle year rollover correctly.
        var newest = new DateTime(referenceDate.Year, referenceDate.Month, 1).AddMonths(-recentBack);
        var outv = new List<YearMonth>(3);
        for (int k = 2; k >= 0; k--)
        {
            var dt = newest.AddMonths(-k);
            outv.Add(new YearMonth(dt.Year, dt.Month));
        }
        return outv;
    }

    /// <summary>e.g. (2026,4) → "Apr 2026" (matches Vanilla _incMonLabel).</summary>
    public static string Label(YearMonth ym) => Mon[ym.Month - 1] + " " + ym.Year;
    public static string Label(int year, int month) => Mon[month - 1] + " " + year;
}
