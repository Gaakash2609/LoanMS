using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LoanMS.Application.IncomeVerification;

// ── Perfios normalization (Phase 3) ───────────────────────────────────────────
// Parses the exact ReportDataJson shape produced by
// frontend/src/utils/perfios/persist.ts (serializePerfiosReport):
//   { __v, valid, span, staledays, firstDate(ms), lastDate(ms), abb, totalTxns,
//     hasSalary, accountInfo{bank,accountNo,ifsc,name,pan,periodFrom,periodTo,...},
//     salaryTxns[], neftTxns[], ... }  where each txn = { date(ms), desc, rawDesc,
//     type:"CR"|"DR", amount, balance, category }.
// Salary-credit candidates = salaryTxns + neftTxns, credits only — the EXACT
// source set Vanilla _crossVerifySalary used (perf.salary + perf.neft, isCredit).
public sealed class PerfiosNormalizationService : IPerfiosNormalizationService
{
    // Same return/reversal narration signal legacy already uses (perfios-renderer
    // isBad=/return|reversal/i + analysis NEFT return=/return|reject/i). Not invented.
    private static readonly Regex ReturnReversal =
        new(@"return|reversal|reject", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public NormalizedBankStatement? Normalize(string? reportDataJson, int? sourcePerfiosReportId = null)
    {
        if (string.IsNullOrWhiteSpace(reportDataJson)) return null;

        JsonDocument doc;
        try { doc = JsonDocument.Parse(reportDataJson); }
        catch { return null; }

        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;

            var result = new NormalizedBankStatement { SourcePerfiosReportId = sourcePerfiosReportId };

            // Account header (ownership tracing).
            if (root.TryGetProperty("accountInfo", out var acc) && acc.ValueKind == JsonValueKind.Object)
            {
                result.Bank = GetStr(acc, "bank");
                result.AccountNo = GetStr(acc, "accountNo");
                result.Ifsc = GetStr(acc, "ifsc");
                result.HolderName = GetStr(acc, "name");
                result.Pan = GetStr(acc, "pan");

                var pFrom = ParseFlexibleDate(GetStr(acc, "periodFrom"));
                var pTo = ParseFlexibleDate(GetStr(acc, "periodTo"));
                if (pFrom is not null && pTo is not null)
                {
                    result.CoverageStart = pFrom;
                    result.CoverageEnd = pTo;
                    result.CoverageSource = "StatementPeriod";
                }
            }

            result.ReportManualReviewRequired =
                root.TryGetProperty("manualReviewRequired", out var mr) &&
                mr.ValueKind == JsonValueKind.True;

            // Salary-credit candidates: salaryTxns + neftTxns, type == "CR".
            AddCandidates(root, "salaryTxns", "Salary", result.SalaryCreditCandidates);
            AddCandidates(root, "neftTxns", "NEFT", result.SalaryCreditCandidates);

            // Coverage fallback: earliest/latest transaction date when no statement
            // period metadata. Reported as "TransactionDates" — a limitation, not a
            // guarantee the statement actually covered the whole period (§26c).
            if (result.CoverageSource == "None")
            {
                DateTime? min = null, max = null;
                foreach (var t in result.SalaryCreditCandidates)
                {
                    if (min is null || t.Date < min) min = t.Date;
                    if (max is null || t.Date > max) max = t.Date;
                }
                // Also fold in the report's own firstDate/lastDate when present.
                var fd = FromMs(root, "firstDate");
                var ld = FromMs(root, "lastDate");
                if (fd is not null && (min is null || fd < min)) min = fd;
                if (ld is not null && (max is null || ld > max)) max = ld;
                if (min is not null && max is not null)
                {
                    result.CoverageStart = min;
                    result.CoverageEnd = max;
                    result.CoverageSource = "TransactionDates";
                }
            }

            return result;
        }
    }

    public string ComputeReportHash(string reportDataJson)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(reportDataJson ?? string.Empty));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    private static void AddCandidates(JsonElement root, string arrayKey, string section, List<NormalizedTransaction> into)
    {
        if (!root.TryGetProperty(arrayKey, out var arr) || arr.ValueKind != JsonValueKind.Array) return;
        foreach (var t in arr.EnumerateArray())
        {
            if (t.ValueKind != JsonValueKind.Object) continue;
            var type = (GetStr(t, "type") ?? "").ToUpperInvariant();
            if (type != "CR") continue;                          // credits only, like Vanilla isCredit

            if (!t.TryGetProperty("amount", out var amtEl)) continue;
            decimal amount = amtEl.ValueKind == JsonValueKind.Number && amtEl.TryGetDecimal(out var a) ? a : 0m;
            if (amount <= 0m) continue;

            long ms = 0;
            DateTime date;
            if (t.TryGetProperty("date", out var dEl) && dEl.ValueKind == JsonValueKind.Number && dEl.TryGetInt64(out ms))
                date = DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime;
            else
                continue;                                        // no date → cannot window-match

            var desc = GetStr(t, "desc") ?? "";
            var raw = GetStr(t, "rawDesc") ?? "";
            into.Add(new NormalizedTransaction
            {
                Date = date,
                DateEpochMs = ms,
                Amount = amount,
                Desc = desc,
                RawDesc = raw,
                Type = "CR",
                Category = GetStr(t, "category"),
                Section = section,
                IsPossibleReturnOrReversal = ReturnReversal.IsMatch(raw) || ReturnReversal.IsMatch(desc),
            });
        }
    }

    private static string? GetStr(JsonElement obj, string name)
        => obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static DateTime? FromMs(JsonElement root, string name)
        => root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var ms)
            ? DateTimeOffset.FromUnixTimeMilliseconds(ms).UtcDateTime : null;

    // Statement period strings come from varied bank formats; try the common ones.
    private static readonly string[] DateFormats =
    {
        "dd/MM/yyyy", "dd-MM-yyyy", "yyyy-MM-dd", "dd MMM yyyy", "dd-MMM-yyyy",
        "d/M/yyyy", "MM/dd/yyyy", "dd.MM.yyyy",
    };

    private static DateTime? ParseFlexibleDate(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        if (DateTime.TryParseExact(s.Trim(), DateFormats, CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var exact)) return exact;
        if (DateTime.TryParse(s.Trim(), CultureInfo.InvariantCulture, DateTimeStyles.None, out var loose)) return loose;
        return null;
    }
}
