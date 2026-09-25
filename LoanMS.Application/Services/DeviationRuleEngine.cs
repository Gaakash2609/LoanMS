using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using LoanMS.Domain.Entities;

namespace LoanMS.Application.Services;

/// <summary>
/// Lender-specific, configurable deviation rule engine (Phase 0 §7). Replaces the
/// former hard-coded global DeviationEvaluator. Pure: the caller loads the rules
/// and the application/offer facts; nothing here touches the database, so the
/// same code serves live evaluation and the dry-run simulation.
///
/// Fail-closed: a value a matching rule needs but that is missing (no bureau
/// CIBIL, no income, no FOIR) is <c>MissingData</c>, and no rule at all for the
/// lender + product + loan type is <c>ManualReview</c>; both make the deviation
/// Required. Nothing is ever defaulted.
/// </summary>
public static class DeviationRuleEngine
{
    // Auto-evaluated deviation types and the metrics each supports.
    public static readonly IReadOnlyDictionary<string, string[]> MetricsByType = new Dictionary<string, string[]>
    {
        ["ROI"]        = new[] { "ROI_MIN_PCT", "ROI_DISCOUNT_PP" },
        ["FOIR"]       = new[] { "FOIR_MAX_PCT" },
        ["LoanAmount"] = new[] { "AMOUNT_MAX", "INCOME_MULTIPLE_MAX" },
        ["Tenure"]     = new[] { "TENURE_MAX_MONTHS", "TENURE_MIN_MONTHS" },
        ["CIBIL"]      = new[] { "CIBIL_MIN" },
    };

    // Manual deviation categories (legacy Raise Deviation dropdown). The auto
    // types above can also be raised manually; Document / Employment / Other /
    // Income are manual-only and never computed.
    public static readonly string[] ManualCategories =
        { "FOIR", "CIBIL", "Income", "Tenure", "LoanAmount", "ROI", "Employment", "Document", "Other" };

    public static readonly string[] ConditionFields =
        { "loanAmount", "offeredRoi", "tenureMonths", "cibil", "income", "foir", "loanPurpose", "employmentType", "customerType", "existingCustomer" };
    public static readonly string[] ConditionOps = { "eq", "neq", "gt", "gte", "lt", "lte", "in" };

    public static string UnitOf(string metric) => metric switch
    {
        "ROI_MIN_PCT"          => "% p.a.",
        "ROI_DISCOUNT_PP"      => "percentage points below Base ROI",
        "FOIR_MAX_PCT"         => "% of monthly income (post-loan FOIR)",
        "AMOUNT_MAX"           => "₹",
        "INCOME_MULTIPLE_MAX"  => "× monthly income",
        "TENURE_MAX_MONTHS"    => "months",
        "TENURE_MIN_MONTHS"    => "months",
        "CIBIL_MIN"            => "bureau score",
        _ => ""
    };

    public sealed class Condition
    {
        [JsonPropertyName("field")] public string Field { get; set; } = "";
        [JsonPropertyName("op")]    public string Op { get; set; } = "";
        [JsonPropertyName("value")] public string Value { get; set; } = "";
    }

    /// <summary>Everything the engine may read. Null = the fact is not available.</summary>
    public sealed class Facts
    {
        public int BankId { get; init; }
        public string ProductKey { get; init; } = "";
        public string LoanType { get; init; } = "";
        public DateTime AsOf { get; init; }
        public decimal LoanAmount { get; init; }
        public int TenureMonths { get; init; }
        public decimal BaseRoi { get; init; }
        public decimal OfferedRoi { get; init; }
        public decimal BtAmount { get; init; }
        /// <summary>Monthly income basis (authoritative FOIR income), null when unavailable.</summary>
        public decimal? MonthlyIncome { get; init; }
        /// <summary>Post-loan FOIR % from the authoritative obligations engine, null when unavailable.</summary>
        public decimal? PostLoanFoirPct { get; init; }
        /// <summary>CIBIL from an active bureau report only — declared scores never go here.</summary>
        public int? BureauCibil { get; init; }
        public int? DeclaredCibil { get; init; }
        public string? EmploymentType { get; init; }
        public string? CustomerType { get; init; }
        public bool? ExistingCustomer { get; init; }
    }

    public sealed class RuleSnapshot
    {
        public int RuleId { get; set; }
        public string RuleKey { get; set; } = "";
        public int Version { get; set; }
        public string Name { get; set; } = "";
        public int BankId { get; set; }
        public string? ProductKey { get; set; }
        public string? LoanType { get; set; }
        public string DeviationType { get; set; } = "";
        public string Metric { get; set; } = "";
        public decimal LimitValue { get; set; }
        public decimal? MaxApprovableDeviation { get; set; }
        public string ConditionsJson { get; set; } = "[]";
        public string ConditionLogic { get; set; } = "AND";
        public int Priority { get; set; }
        public DateTime EffectiveFrom { get; set; }
        public DateTime? EffectiveTo { get; set; }
        public bool ApprovalRequired { get; set; }
    }

    public sealed class CheckResult
    {
        public string DeviationType { get; set; } = "";
        public string Metric { get; set; } = "";
        /// <summary>Within / Breach / MissingData / Conflict.</summary>
        public string Status { get; set; } = "";
        public decimal? Actual { get; set; }
        public decimal? Allowed { get; set; }
        public decimal? Difference { get; set; }
        public string Unit { get; set; } = "";
        public bool ApprovalRequired { get; set; }
        /// <summary>True when the breach is larger than the rule's authority limit — it cannot be approved.</summary>
        public bool ExceedsAuthority { get; set; }
        public string Message { get; set; } = "";
        public RuleSnapshot? Rule { get; set; }
        public List<int>? ConflictingRuleIds { get; set; }
    }

    public sealed class Evaluation
    {
        /// <summary>NotRequired / Required.</summary>
        public string Outcome { get; set; } = "Required";
        public bool ManualReview { get; set; }
        public string? ManualReviewReason { get; set; }
        public List<CheckResult> Checks { get; set; } = new();
        public DateTime EvaluatedAt { get; set; }
        public Dictionary<string, string?> FactsUsed { get; set; } = new();
    }

    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static List<Condition> ParseConditions(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new();
        return JsonSerializer.Deserialize<List<Condition>>(json, Json) ?? new();
    }

    public static string Serialize(object o) => JsonSerializer.Serialize(o, Json);

    /// <summary>Is this rule version in force at <paramref name="asOf"/>?</summary>
    public static bool InForce(DeviationRule r, DateTime asOf) =>
        r.IsActive && r.SupersededAt == null && r.EffectiveFrom <= asOf && (r.EffectiveTo == null || r.EffectiveTo >= asOf);

    public static bool Scoped(DeviationRule r, Facts f) =>
        r.BankId == f.BankId
        && (string.IsNullOrEmpty(r.ProductKey) || string.Equals(r.ProductKey, f.ProductKey, StringComparison.OrdinalIgnoreCase))
        && (string.IsNullOrEmpty(r.LoanType) || string.Equals(r.LoanType, f.LoanType, StringComparison.OrdinalIgnoreCase));

    public static int Specificity(DeviationRule r) =>
        ParseConditions(r.ConditionsJson).Count
        + (string.IsNullOrEmpty(r.ProductKey) ? 0 : 1)
        + (string.IsNullOrEmpty(r.LoanType) ? 0 : 1);

    public static Evaluation Evaluate(IEnumerable<DeviationRule> allRules, Facts f)
    {
        var ev = new Evaluation { EvaluatedAt = f.AsOf, FactsUsed = DescribeFacts(f) };
        var candidates = allRules.Where(r => InForce(r, f.AsOf) && Scoped(r, f)).ToList();

        if (candidates.Count == 0)
        {
            ev.ManualReview = true;
            ev.ManualReviewReason = "No deviation policy is configured for this lender, product and loan type — manual review required.";
            ev.Outcome = "Required";
            return ev;
        }

        foreach (var group in candidates.GroupBy(r => (r.DeviationType, r.Metric)).OrderBy(g => g.Key.DeviationType).ThenBy(g => g.Key.Metric))
        {
            var (type, metric) = group.Key;
            // Which rules of this metric apply to this application?
            var applicable = new List<DeviationRule>();
            var conditionDataMissing = new List<string>();
            foreach (var r in group)
            {
                var m = MatchConditions(r, f, out var missing);
                if (m == true) applicable.Add(r);
                else if (m == null) conditionDataMissing.AddRange(missing);
            }

            if (applicable.Count == 0)
            {
                if (conditionDataMissing.Count > 0)
                    ev.Checks.Add(new CheckResult
                    {
                        DeviationType = type, Metric = metric, Status = "MissingData", Unit = UnitOf(metric), ApprovalRequired = true,
                        Message = $"Cannot decide which {type} rule applies — missing: {string.Join(", ", conditionDataMissing.Distinct())}."
                    });
                continue; // no rule of this metric applies to this application
            }

            var ordered = applicable
                .OrderBy(r => r.Priority)
                .ThenByDescending(Specificity)
                .ThenByDescending(r => r.EffectiveFrom)
                .ToList();
            var top = ordered[0];
            if (ordered.Count > 1)
            {
                var second = ordered[1];
                if (second.Priority == top.Priority && Specificity(second) == Specificity(top) && second.EffectiveFrom == top.EffectiveFrom)
                {
                    ev.Checks.Add(new CheckResult
                    {
                        DeviationType = type, Metric = metric, Status = "Conflict", Unit = UnitOf(metric), ApprovalRequired = true,
                        ConflictingRuleIds = ordered.Where(r => r.Priority == top.Priority && Specificity(r) == Specificity(top) && r.EffectiveFrom == top.EffectiveFrom).Select(r => r.Id).ToList(),
                        Message = $"Rule conflict for {type} ({metric}): equal priority, specificity and effective date — fix the rule configuration."
                    });
                    continue;
                }
            }
            ev.Checks.Add(Check(top, f));
        }

        var blocking = ev.Checks.Any(c => c.Status is "MissingData" or "Conflict" || (c.Status == "Breach" && c.ApprovalRequired));
        ev.Outcome = blocking ? "Required" : "NotRequired";
        return ev;
    }

    private static CheckResult Check(DeviationRule r, Facts f)
    {
        var c = new CheckResult
        {
            DeviationType = r.DeviationType, Metric = r.Metric, Unit = UnitOf(r.Metric),
            Allowed = r.LimitValue, ApprovalRequired = r.ApprovalRequired, Rule = Snap(r)
        };
        decimal? actual = null;
        bool breach = false;
        decimal diff = 0;
        string? missing = null;
        switch (r.Metric)
        {
            case "ROI_MIN_PCT":
                actual = f.OfferedRoi; breach = actual < r.LimitValue; diff = r.LimitValue - actual.Value; break;
            case "ROI_DISCOUNT_PP":
                if (f.BaseRoi <= 0) { missing = "Base ROI"; break; }
                actual = f.BaseRoi - f.OfferedRoi; breach = actual > r.LimitValue; diff = actual.Value - r.LimitValue; break;
            case "FOIR_MAX_PCT":
                if (f.PostLoanFoirPct == null) { missing = "FOIR (income / obligations)"; break; }
                actual = f.PostLoanFoirPct; breach = actual > r.LimitValue; diff = actual.Value - r.LimitValue; break;
            case "AMOUNT_MAX":
                actual = f.LoanAmount; breach = actual > r.LimitValue; diff = actual.Value - r.LimitValue; break;
            case "INCOME_MULTIPLE_MAX":
                if (f.MonthlyIncome is not > 0) { missing = "monthly income"; break; }
                actual = Math.Round(f.LoanAmount / f.MonthlyIncome.Value, 2); breach = actual > r.LimitValue; diff = actual.Value - r.LimitValue; break;
            case "TENURE_MAX_MONTHS":
                actual = f.TenureMonths; breach = actual > r.LimitValue; diff = actual.Value - r.LimitValue; break;
            case "TENURE_MIN_MONTHS":
                actual = f.TenureMonths; breach = actual < r.LimitValue; diff = r.LimitValue - actual.Value; break;
            case "CIBIL_MIN":
                if (f.BureauCibil == null)
                {
                    missing = f.DeclaredCibil is > 0
                        ? $"bureau-verified CIBIL (only a declared score {f.DeclaredCibil} is on file — not used)"
                        : "bureau-verified CIBIL";
                    break;
                }
                actual = f.BureauCibil; breach = actual < r.LimitValue; diff = r.LimitValue - actual.Value; break;
            default:
                c.Status = "Conflict"; c.Message = $"Unknown metric {r.Metric}."; return c;
        }

        if (missing != null)
        {
            c.Status = "MissingData"; c.ApprovalRequired = true;
            c.Message = $"{r.DeviationType}: {missing} not available — manual review required (no value assumed).";
            return c;
        }
        c.Actual = actual;
        c.Difference = breach ? Math.Round(diff, 2) : 0;
        c.Status = breach ? "Breach" : "Within";
        c.ExceedsAuthority = breach && r.MaxApprovableDeviation is { } max && diff > max;
        c.Message = breach
            ? $"{r.DeviationType}: {Fmt(actual)} is {(IsMinimum(r.Metric) ? "below the minimum of" : "above the maximum of")} {Fmt(r.LimitValue)} ({UnitOf(r.Metric)}) — deviation of {Fmt(Math.Round(diff, 2))}."
              + (c.ExceedsAuthority ? $" Exceeds the approvable limit of {Fmt(r.MaxApprovableDeviation!.Value)}." : "")
            : $"{r.DeviationType}: {Fmt(actual)} {(IsMinimum(r.Metric) ? "meets the minimum of" : "is within the maximum of")} {Fmt(r.LimitValue)} ({UnitOf(r.Metric)}).";
        return c;
    }

    /// <summary>true = all/any conditions hold, false = they don't, null = a needed fact is missing.</summary>
    public static bool? MatchConditions(DeviationRule r, Facts f, out List<string> missing)
    {
        missing = new List<string>();
        var conds = ParseConditions(r.ConditionsJson);
        if (conds.Count == 0) return true;
        var isOr = string.Equals(r.ConditionLogic, "OR", StringComparison.OrdinalIgnoreCase);
        var results = new List<bool?>();
        foreach (var c in conds)
        {
            var v = FactValue(c.Field, f);
            if (v == null) { missing.Add(c.Field); results.Add(null); continue; }
            results.Add(Compare(v, c.Op, c.Value));
        }
        if (isOr)
        {
            if (results.Any(x => x == true)) return true;
            if (results.Any(x => x == null)) return null;
            return false;
        }
        if (results.Any(x => x == false)) return false;
        if (results.Any(x => x == null)) return null;
        return true;
    }

    private static string? FactValue(string field, Facts f) => field switch
    {
        "loanAmount"       => f.LoanAmount.ToString(CultureInfo.InvariantCulture),
        "offeredRoi"       => f.OfferedRoi.ToString(CultureInfo.InvariantCulture),
        "tenureMonths"     => f.TenureMonths.ToString(CultureInfo.InvariantCulture),
        "cibil"            => f.BureauCibil?.ToString(CultureInfo.InvariantCulture),
        "income"           => f.MonthlyIncome is > 0 ? f.MonthlyIncome.Value.ToString(CultureInfo.InvariantCulture) : null,
        "foir"             => f.PostLoanFoirPct?.ToString(CultureInfo.InvariantCulture),
        "loanPurpose"      => f.BtAmount > 0 ? "BT" : "FRESH",
        "employmentType"   => string.IsNullOrWhiteSpace(f.EmploymentType) ? null : f.EmploymentType,
        "customerType"     => string.IsNullOrWhiteSpace(f.CustomerType) ? null : f.CustomerType,
        "existingCustomer" => f.ExistingCustomer?.ToString().ToLowerInvariant(),
        _ => null
    };

    private static bool Compare(string actual, string op, string expected)
    {
        var numeric = decimal.TryParse(actual, NumberStyles.Number, CultureInfo.InvariantCulture, out var a);
        decimal b = 0;
        var expNumeric = op != "in" && decimal.TryParse(expected, NumberStyles.Number, CultureInfo.InvariantCulture, out b);
        switch (op)
        {
            case "eq":  return numeric && expNumeric ? a == b : string.Equals(actual, expected?.Trim(), StringComparison.OrdinalIgnoreCase);
            case "neq": return numeric && expNumeric ? a != b : !string.Equals(actual, expected?.Trim(), StringComparison.OrdinalIgnoreCase);
            case "gt":  return numeric && expNumeric && a > b;
            case "gte": return numeric && expNumeric && a >= b;
            case "lt":  return numeric && expNumeric && a < b;
            case "lte": return numeric && expNumeric && a <= b;
            case "in":  return (expected ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                                .Any(x => string.Equals(x, actual, StringComparison.OrdinalIgnoreCase));
            default: return false;
        }
    }

    public static RuleSnapshot Snap(DeviationRule r) => new()
    {
        RuleId = r.Id, RuleKey = r.RuleKey, Version = r.Version, Name = r.Name, BankId = r.BankId,
        ProductKey = r.ProductKey, LoanType = r.LoanType, DeviationType = r.DeviationType, Metric = r.Metric,
        LimitValue = r.LimitValue, MaxApprovableDeviation = r.MaxApprovableDeviation,
        ConditionsJson = r.ConditionsJson, ConditionLogic = r.ConditionLogic, Priority = r.Priority,
        EffectiveFrom = r.EffectiveFrom, EffectiveTo = r.EffectiveTo, ApprovalRequired = r.ApprovalRequired
    };

    private static Dictionary<string, string?> DescribeFacts(Facts f) => new()
    {
        ["loanAmount"] = f.LoanAmount.ToString(CultureInfo.InvariantCulture),
        ["tenureMonths"] = f.TenureMonths.ToString(CultureInfo.InvariantCulture),
        ["baseRoi"] = f.BaseRoi.ToString(CultureInfo.InvariantCulture),
        ["offeredRoi"] = f.OfferedRoi.ToString(CultureInfo.InvariantCulture),
        ["monthlyIncome"] = f.MonthlyIncome?.ToString(CultureInfo.InvariantCulture),
        ["postLoanFoirPct"] = f.PostLoanFoirPct?.ToString(CultureInfo.InvariantCulture),
        ["bureauCibil"] = f.BureauCibil?.ToString(CultureInfo.InvariantCulture),
        ["declaredCibil"] = f.DeclaredCibil?.ToString(CultureInfo.InvariantCulture),
        ["cibilSource"] = f.BureauCibil != null ? "bureau" : f.DeclaredCibil is > 0 ? "declared (not used)" : "none",
        ["loanPurpose"] = f.BtAmount > 0 ? "BT" : "FRESH",
        ["employmentType"] = f.EmploymentType,
    };

    private static bool IsMinimum(string metric) => metric is "ROI_MIN_PCT" or "TENURE_MIN_MONTHS" or "CIBIL_MIN";

    private static string Fmt(decimal? v) => v?.ToString("0.##", CultureInfo.InvariantCulture) ?? "—";

    /// <summary>Save-time validation of a rule version against the other in-force versions of other rule keys.</summary>
    public static List<string> ValidateRule(DeviationRule r, IEnumerable<DeviationRule> others)
    {
        var e = new List<string>();
        if (string.IsNullOrWhiteSpace(r.Name)) e.Add("Rule name is required.");
        if (r.BankId <= 0) e.Add("Lender is required — global rules are not allowed.");
        if (!MetricsByType.TryGetValue(r.DeviationType ?? "", out var metrics))
            e.Add($"Deviation type must be one of: {string.Join(", ", MetricsByType.Keys)} (manual-only categories are not rule-driven).");
        else if (!metrics.Contains(r.Metric)) e.Add($"Metric for {r.DeviationType} must be one of: {string.Join(", ", metrics)}.");
        if (r.LimitValue < 0) e.Add("Limit cannot be negative.");
        if (r.MaxApprovableDeviation is < 0) e.Add("Max approvable deviation cannot be negative.");
        if (r.Priority < 1 || r.Priority > 1000) e.Add("Priority must be between 1 and 1000.");
        if (r.EffectiveTo != null && r.EffectiveTo < r.EffectiveFrom) e.Add("Effective To must be on or after Effective From.");
        if (r.ConditionLogic is not ("AND" or "OR")) e.Add("Condition logic must be AND or OR.");
        List<Condition> conds;
        try { conds = ParseConditions(r.ConditionsJson); }
        catch (JsonException) { e.Add("Conditions are not valid JSON."); return e; }
        foreach (var c in conds)
        {
            if (!ConditionFields.Contains(c.Field)) e.Add($"Unknown condition field '{c.Field}'.");
            if (!ConditionOps.Contains(c.Op)) e.Add($"Unknown condition operator '{c.Op}'.");
            if (string.IsNullOrWhiteSpace(c.Value)) e.Add($"Condition '{c.Field}' needs a value.");
        }
        var sigs = conds.Select(c => $"{c.Field}|{c.Op}|{c.Value.Trim().ToLowerInvariant()}").ToList();
        if (sigs.Count != sigs.Distinct().Count()) e.Add("Duplicate condition.");

        // Overlap / conflict with another rule key: same lender, product, loan type,
        // metric, priority, identical conditions and overlapping effective window
        // would produce an unresolvable tie at evaluation time.
        var sig = string.Join(";", sigs.OrderBy(x => x)) + "|" + r.ConditionLogic;
        foreach (var o in others.Where(o => o.RuleKey != r.RuleKey && o.IsActive && o.SupersededAt == null))
        {
            if (o.BankId != r.BankId || o.Metric != r.Metric || o.Priority != r.Priority) continue;
            if (!string.Equals(o.ProductKey ?? "", r.ProductKey ?? "", StringComparison.OrdinalIgnoreCase)) continue;
            if (!string.Equals(o.LoanType ?? "", r.LoanType ?? "", StringComparison.OrdinalIgnoreCase)) continue;
            var osig = string.Join(";", ParseConditions(o.ConditionsJson).Select(c => $"{c.Field}|{c.Op}|{c.Value.Trim().ToLowerInvariant()}").OrderBy(x => x)) + "|" + o.ConditionLogic;
            if (osig != sig) continue;
            var overlap = (o.EffectiveTo == null || o.EffectiveTo >= r.EffectiveFrom) && (r.EffectiveTo == null || r.EffectiveTo >= o.EffectiveFrom);
            if (overlap) e.Add($"Overlaps rule '{o.Name}' ({o.RuleKey} v{o.Version}): same lender, product, loan type, metric, priority and conditions with an overlapping effective period. Change the priority, conditions or dates.");
        }
        return e;
    }
}
