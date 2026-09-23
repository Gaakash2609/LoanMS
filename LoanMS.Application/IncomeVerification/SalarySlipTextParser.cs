using System.Globalization;
using System.Text.RegularExpressions;

namespace LoanMS.Application.IncomeVerification;

// ── Salary-slip text parser (Phase 3 — trusted salary input) ──────────────────
// A FAITHFUL C# port of frontend/src/utils/salarySlipExtraction.ts (which is
// itself the port of Vanilla efin-app.js pseTryExtract/pseDetectMonth). Same
// currency-stripping amount parser, the same Net-Pay label synonyms, the same
// "for the month of …" month detection. Running the SAME logic server-side lets
// the backend re-derive the ORIGINAL net salary from the slip text/vision output
// itself (§26a), instead of trusting a client-posted number. Pure + deterministic.
public static class SalarySlipTextParser
{
    private const string Mon =
        "january|february|march|april|may|june|july|august|september|october|november|december|" +
        "jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec";

    // Legacy NET_RE / GROSS_RE synonym sets (verbatim from salarySlipExtraction.ts).
    private static readonly Regex NetRe = new(
        @"\bnet\s*(?:pay(?:able)?|salary|sal|take.?home|wage|earnings?|remuneration|amount|income)\b|\bnet\s*payable\b|\b(?:in.?hand|take.?home)\b|\bamount\s*(?:payable|paid|credited|transferred|disbursed)\b|\b(?:salary|sal)\s*(?:payable|paid|credited|after\s*deductions?)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex GrossRe = new(
        @"\bgross\s*(?:pay|salary|earnings?|total|income)?\b|\btotal\s*earnings?\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex AmountToken = new(@"\d[\d,]*(?:\.\d{1,2})?", RegexOptions.Compiled);

    private static readonly Regex NetFlatFallback = new(
        @"(?:net\s*pay(?:able)?|take.?home|in.?hand|amount\s*credited)\s*[:-]?\s*(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d{1,2})?)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Legacy amt(): strip INR/₹/Rs then read the first amount token → value or 0.</summary>
    public static decimal ParseAmount(string? s)
    {
        if (s is null) return 0m;
        var cleaned = Regex.Replace(s, @"\bINR\.?\b", "", RegexOptions.IgnoreCase);
        cleaned = cleaned.Replace("₹", "");
        cleaned = Regex.Replace(cleaned, @"\bRs\.?\b", "", RegexOptions.IgnoreCase);
        var m = AmountToken.Match(cleaned);
        if (!m.Success) return 0m;
        return decimal.TryParse(m.Value.Replace(",", ""), NumberStyles.Any, CultureInfo.InvariantCulture, out var v) && v > 0m
            ? v : 0m;
    }

    // Legacy nums(): every amount token (>= 0) in a string.
    private static List<decimal> NumsIn(string s)
    {
        var outv = new List<decimal>();
        foreach (Match m in AmountToken.Matches(s))
            if (decimal.TryParse(m.Value.Replace(",", ""), NumberStyles.Any, CultureInfo.InvariantCulture, out var v) && v >= 0m)
                outv.Add(v);
        return outv;
    }

    private static string FmtMonth(string mon, string yr)
    {
        var shortM = mon.Length >= 3 ? mon.Substring(0, 3) : mon;
        return char.ToUpperInvariant(shortM[0]) + shortM.Substring(1).ToLowerInvariant() + " " + yr;
    }

    /// <summary>Port of pseDetectMonth: prefer an explicit "for the month of …"
    /// phrase; else the first month+year pair. Returns e.g. "Apr 2026" or null.</summary>
    public static string? DetectSalaryMonth(string text)
    {
        var flat = Regex.Replace(text, @"\s{2,}", " ");
        string[] priority =
        {
            @"pay\s*slip\s+for\s+the\s+month\s+of\s+(" + Mon + @")\s+(\d{4})",
            @"salary\s*slip\s+for\s+(?:the\s+month\s+of\s+)?(" + Mon + @")\s+(\d{4})",
            @"(?:pay|salary)\s*(?:period|month)\s*[:-]?\s*(" + Mon + @")\s+(\d{4})",
            @"for\s+the\s+month\s+of\s+(" + Mon + @")\s+(\d{4})",
        };
        foreach (var p in priority)
        {
            var m = Regex.Match(flat, p, RegexOptions.IgnoreCase);
            if (m.Success) return FmtMonth(m.Groups[1].Value, m.Groups[2].Value);
        }
        var any = Regex.Match(flat, @"\b(" + Mon + @")\s+(\d{4})\b", RegexOptions.IgnoreCase);
        return any.Success ? FmtMonth(any.Groups[1].Value, any.Groups[2].Value) : null;
    }

    /// <summary>Extract Net Pay + Gross + Month from a payslip's text (PDF-extracted
    /// or AI-vision text). Nulls when a field isn't confidently found (→ manual entry).</summary>
    public static SalarySlipData Parse(string text)
    {
        var lines = text
            .Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(l => Regex.Replace(l, @"\s{2,}", " ").Trim())
            .Where(l => l.Length > 1)
            .ToList();
        var flat = string.Join(" ", lines);

        decimal? netPay = null, gross = null;
        foreach (var line in lines)
        {
            if (netPay is null && NetRe.IsMatch(line))
            {
                var n = NumsIn(line);
                if (n.Count > 0) netPay = n.Max();
            }
            if (gross is null && GrossRe.IsMatch(line))
            {
                var n = NumsIn(line);
                if (n.Count > 0) gross = n.Max();
            }
        }
        if (netPay is null)
        {
            var m = NetFlatFallback.Match(flat);
            if (m.Success)
            {
                var v = ParseAmount(m.Groups[1].Value);
                if (v > 0m) netPay = v;
            }
        }
        return new SalarySlipData { NetPay = netPay, Gross = gross, Month = DetectSalaryMonth(text) };
    }

    /// <summary>The prompt handed to the AI-vision relay for image payslips
    /// (identical to the frontend's SALARY_SLIP_VISION_PROMPT).</summary>
    public const string VisionPrompt =
        "This is a salary slip / payslip. Extract and return ONLY these lines exactly:\n" +
        "MONTH: <salary month and year, e.g. January 2026>\n" +
        "NET_PAY: <net pay / take-home amount in numbers only>\n" +
        "GROSS: <gross salary amount in numbers only>\n" +
        "If a value is not present, write the label with an empty value.";
}

public sealed class SalarySlipData
{
    public decimal? NetPay { get; set; }
    public decimal? Gross { get; set; }
    public string? Month { get; set; }
}
