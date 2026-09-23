using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LoanMS.Application.DTOs;

namespace LoanMS.Application.Obligations;

// ── Bank-statement obligation detection (deterministic) ───────────────────────
// Parses the persisted PerfiosReport.ReportDataJson (same shape serialized by
// frontend/src/utils/perfios/persist.ts — arrays achTxns / ecsTxns / allTxns, each
// txn = { date(ms), desc, rawDesc, type:"CR"|"DR", amount, category }) and finds
// RECURRING debits that look like loan EMIs / mandate deductions.
//
// Determinism rules (so the same statement always yields the same candidates):
//   • only DEBIT ("DR") transactions are considered;
//   • the source set is the ACH/NACH + ECS mandate channels plus any debit the
//     statement itself already categorised as "Loan/EMI" (the same evidence the
//     existing analysis classifies — nothing new invented);
//   • debits are grouped by a normalized lender narration + rounded amount;
//   • a group is a candidate only when it recurs in ≥ 2 DISTINCT calendar months
//     (a single hit, or two hits in one month, is not treated as a monthly EMI);
//   • EMI = the group's representative recurring amount; lender = the cleaned
//     narration merchant tokens (evidence, not invented); everything the evidence
//     does not reveal (outstanding, tenure, rate, account no.) stays null.
public sealed class ObligationDetectionService : IObligationDetectionService
{
    private static readonly Regex EmiNarration =
        new(@"\bemi\b|\bloan\b|\binstal?ment\b|\bfinanc|\bhous(ing)? *loan\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    // Routing / rail noise stripped from the narration before deriving the lender
    // merchant key — brand tokens (HDFC, BAJAJ, TATA, FINSERV…) are deliberately kept.
    private static readonly HashSet<string> NoiseTokens = new(StringComparer.OrdinalIgnoreCase)
    {
        "ACH", "NACH", "ECS", "SI", "DR", "CR", "MANDATE", "AUTOPAY", "AUTO", "AUTODEBIT",
        "DEBIT", "PAYMENT", "PAY", "EMI", "INSTALMENT", "INSTALLMENT", "UPI", "NEFT",
        "RTGS", "IMPS", "INB", "TXN", "TRANSFER", "REF", "COLLECT", "BILLDESK", "RAZORPAY",
        "BILL", "MMS", "CMS", "TO", "FROM", "THE", "OF", "AND", "VIA", "ACHDR", "NACHDR",
        "RETURN", "REVERSAL", "CHRG", "CHARGE", "GST", "IGST", "CGST", "SGST",
    };

    private static readonly Regex NonAlpha = new(@"[^A-Za-z]+", RegexOptions.Compiled);

    public List<DetectedObligationCandidateDto> Detect(string? reportDataJson)
    {
        var result = new List<DetectedObligationCandidateDto>();
        if (string.IsNullOrWhiteSpace(reportDataJson)) return result;

        JsonDocument doc;
        try { doc = JsonDocument.Parse(reportDataJson); }
        catch { return result; }

        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return result;

            var debits = new List<Debit>();
            CollectChannel(root, "achTxns", "ACH/NACH", debits, requireEmiNarration: false);
            CollectChannel(root, "ecsTxns", "ECS", debits, requireEmiNarration: false);
            // From the full ledger, only debits the statement categorised as Loan/EMI
            // or whose narration clearly says EMI/loan — avoids sweeping in groceries.
            CollectChannel(root, "allTxns", "EMI", debits, requireEmiNarration: true);

            // De-duplicate: a debit can appear in both allTxns and a channel array.
            var seen = new HashSet<string>();
            var unique = new List<Debit>();
            foreach (var d in debits)
            {
                var k = $"{d.DateEpochMs}|{d.Amount}|{d.RawDesc}";
                if (seen.Add(k)) unique.Add(d);
            }

            // Group by lender merchant key + rounded amount bucket.
            var groups = unique
                .Select(d => new { d, key = MerchantKey(d.Desc, d.RawDesc), bucket = Math.Round(d.Amount) })
                .Where(x => x.bucket > 0)
                .GroupBy(x => $"{x.key}|{x.bucket:0}");

            foreach (var g in groups)
            {
                var items = g.Select(x => x.d).OrderBy(d => d.Date).ToList();
                var distinctMonths = items.Select(d => d.Date.Year * 12 + d.Date.Month).Distinct().Count();
                if (items.Count < 2 || distinctMonths < 2) continue; // not recurring monthly

                var merchant = items[0].MerchantKeyOrNull();
                var amount = RepresentativeAmount(items);
                var evidence = items
                    .OrderByDescending(d => d.Date)
                    .Take(12)
                    .Select(d => new { date = d.DateEpochMs, amount = d.Amount, desc = Trim(d.RawDesc, 80) })
                    .ToList();

                result.Add(new DetectedObligationCandidateDto
                {
                    DetectionSignature = Trim(g.Key, 190),
                    Emi = amount,
                    FinancerName = merchant,
                    AccountNumber = null,               // never invented — not exposed by a debit narration
                    Channel = items[0].Channel,
                    OccurrenceCount = items.Count,
                    FirstSeen = items.First().Date,
                    LastSeen = items.Last().Date,
                    EvidenceJson = JsonSerializer.Serialize(evidence),
                });
            }

            // Stable ordering: strongest signal (most occurrences, then largest EMI) first.
            return result
                .OrderByDescending(c => c.OccurrenceCount)
                .ThenByDescending(c => c.Emi)
                .ToList();
        }
    }

    private static void CollectChannel(JsonElement root, string arrayKey, string channel, List<Debit> into, bool requireEmiNarration)
    {
        if (!root.TryGetProperty(arrayKey, out var arr) || arr.ValueKind != JsonValueKind.Array) return;
        foreach (var t in arr.EnumerateArray())
        {
            if (t.ValueKind != JsonValueKind.Object) continue;
            var type = (GetStr(t, "type") ?? "").ToUpperInvariant();
            if (type != "DR") continue;

            if (!t.TryGetProperty("amount", out var amtEl)) continue;
            decimal amount = amtEl.ValueKind == JsonValueKind.Number && amtEl.TryGetDecimal(out var a) ? a : 0m;
            if (amount <= 0m) continue;

            if (!(t.TryGetProperty("date", out var dEl) && dEl.ValueKind == JsonValueKind.Number && dEl.TryGetInt64(out var ms)))
                continue;

            var desc = GetStr(t, "desc") ?? "";
            var raw = GetStr(t, "rawDesc") ?? "";
            var category = GetStr(t, "category") ?? "";

            if (requireEmiNarration)
            {
                var isLoanEmi = category.Contains("Loan", StringComparison.OrdinalIgnoreCase)
                                || category.Contains("EMI", StringComparison.OrdinalIgnoreCase)
                                || EmiNarration.IsMatch(raw) || EmiNarration.IsMatch(desc);
                if (!isLoanEmi) continue;
            }

            // Skip obvious return/reversal narrations — a bounced EMI is not a burden.
            if (Regex.IsMatch(raw, @"return|reversal|reject", RegexOptions.IgnoreCase)) continue;

            into.Add(new Debit
            {
                Date = DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime,
                DateEpochMs = ms,
                Amount = amount,
                Desc = desc,
                RawDesc = raw,
                Channel = channel,
            });
        }
    }

    // Cleaned, title-cased lender name from the narration merchant tokens, or null
    // when nothing recognisable remains (never fabricated).
    private static string MerchantKey(string desc, string raw)
    {
        var src = !string.IsNullOrWhiteSpace(desc) ? desc : raw;
        var tokens = NonAlpha.Split(src.ToUpperInvariant())
            .Where(w => w.Length >= 3 && !NoiseTokens.Contains(w))
            .Take(4)
            .ToList();
        return tokens.Count == 0 ? "" : string.Join(' ', tokens);
    }

    private static decimal RepresentativeAmount(List<Debit> items)
    {
        // Most frequent exact amount; ties → the largest (a fuller EMI is safer than
        // an odd partial debit). Falls back to the rounded average.
        var mode = items.GroupBy(d => d.Amount)
            .OrderByDescending(x => x.Count()).ThenByDescending(x => x.Key)
            .FirstOrDefault();
        if (mode != null) return Math.Round(mode.Key, 2);
        return Math.Round(items.Average(d => d.Amount), 2);
    }

    private static string? GetStr(JsonElement obj, string name)
        => obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static string Trim(string s, int max) => s.Length <= max ? s : s[..max];

    private sealed class Debit
    {
        public DateTime Date { get; set; }
        public long DateEpochMs { get; set; }
        public decimal Amount { get; set; }
        public string Desc { get; set; } = "";
        public string RawDesc { get; set; } = "";
        public string Channel { get; set; } = "";

        public string? MerchantKeyOrNull()
        {
            var m = MerchantKey(Desc, RawDesc);
            if (string.IsNullOrWhiteSpace(m)) return null;
            var titled = string.Join(' ', m.Split(' ')
                .Select(w => w.Length == 0 ? w : char.ToUpperInvariant(w[0]) + w[1..].ToLowerInvariant()));
            return Trim(titled, 60);
        }
    }
}
