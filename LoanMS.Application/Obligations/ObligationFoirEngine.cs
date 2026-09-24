using LoanMS.Application.DTOs;
using LoanMS.Application.Services;

namespace LoanMS.Application.Obligations;

// ── Obligation FOIR / credit-capacity engine (authoritative, server-side) ─────
// The single business authority for FOIR on the Obligations tab. React previously
// computed this entirely client-side (the former frontend utils/foir.ts). The suggested-FOIR / ROI /
// self-employed-net heuristics here are a faithful port of that tested logic
// (itself a verbatim port of legacy renderFoirPanel / getSuggestedFOIR /
// getSuggestedROI), so numbers stay consistent — but the AUTHORITATIVE capacity
// and pass/fail decision are driven by the resolved lender/product FOIR policy
// (BankProductRule.FoirLimit ?? BankMaster.FoirLimit), NOT a hard-coded 50% rule.
// When no policy is on file the engine reports the FACTUAL FOIR and makes no
// pass/fail decision (PassesLenderLimit = null), exactly as instructed.
//
// Pure and side-effect free: the service assembles inputs from persisted data and
// this returns the numbers. No DB, no client state.
public static class ObligationFoirEngine
{
    public sealed class ObligationEmi
    {
        public decimal LoanEmi { get; set; }
        public bool SelectBT { get; set; }
        public decimal AmountOutstanding { get; set; }
    }

    public sealed class Input
    {
        public decimal GrossIncome { get; set; }
        public string? EmploymentType { get; set; }
        public string? LoanType { get; set; }          // frontend product key, e.g. "personal_loan"
        public int? Cibil { get; set; }
        public int? TenureMonths { get; set; }
        public decimal? InterestRate { get; set; }
        public decimal RequestedAmount { get; set; }
        /// <summary>ACTIVE, non-rejected obligations only (caller filters).</summary>
        public List<ObligationEmi> Obligations { get; set; } = new();
        public decimal CoApplicantIncome { get; set; }
        /// <summary>Self-employed only: net income from a Perfios-verified statement
        /// (ABB). When > 0 it is preferred over the 70%-of-gross estimate.</summary>
        public decimal? VerifiedNetIncome { get; set; }
        /// <summary>Salaried only: bank-verified trusted salary from IncomeVerification
        /// (AutoVerified / ManualReviewCompleted-Approved). When > 0 it replaces the
        /// declared gross.</summary>
        public decimal? TrustedSalariedIncome { get; set; }
        /// <summary>What-if override of the proposed loan EMI. Null → derive from the
        /// loan's own EMI / amount+rate+tenure (caller sets ProposedEmiResolved).</summary>
        public decimal ProposedEmi { get; set; }
        public string ProposedEmiSource { get; set; } = "loan";
        /// <summary>Resolved lender/product FOIR limit %, or null when no policy.</summary>
        public decimal? ApplicableFoirLimitPct { get; set; }
        public string FoirLimitSource { get; set; } = "None";
        public string? LenderName { get; set; }
        public string? ProductKey { get; set; }
        /// <summary>What-if FOIR% from the eligibility slider (clamped 40–80). When set
        /// it drives the capacity/headroom (mirrors Vanilla's FOIR slider); the lender
        /// pass/fail decision below stays independent of it.</summary>
        public int? FoirOverride { get; set; }
    }

    public static ObligationFoirResultDto Compute(Input i)
    {
        var r = new ObligationFoirResultDto
        {
            DeclaredIncome = i.GrossIncome,
            CoApplicantIncome = Math.Max(0, i.CoApplicantIncome),
            ProposedEmi = Math.Max(0, i.ProposedEmi),
            ProposedEmiSource = i.ProposedEmiSource,
            ApplicableFoirLimitPct = i.ApplicableFoirLimitPct,
            FoirLimitSource = i.FoirLimitSource,
            LenderName = i.LenderName,
            ProductKey = i.ProductKey,
        };

        var isSelfEmp = IsSelfEmployed(i.EmploymentType);
        var loanType = string.IsNullOrWhiteSpace(i.LoanType) ? "personal_loan" : i.LoanType!;
        var cibil = i.Cibil ?? 700;
        var tenure = i.TenureMonths is > 0 ? i.TenureMonths!.Value : 36;

        // Income basis (mirrors FoirEligibilityPanel):
        //  • self-employed → verified bank ABB when present, else 70%-of-gross estimate
        //  • salaried       → bank-verified trusted salary when present, else declared gross
        decimal primaryNetIncome;
        if (isSelfEmp)
        {
            var hasVerified = (i.VerifiedNetIncome ?? 0) > 0;
            primaryNetIncome = hasVerified ? Math.Round(i.VerifiedNetIncome!.Value) : Math.Round(i.GrossIncome * 0.70m);
            r.IncomeBasis = hasVerified ? "self-employed-verified-abb" : "self-employed-estimated";
            r.IncomeBasisNote = hasVerified
                ? "Self-employed net income from a Perfios-verified bank statement (ABB)."
                : "Self-employed net income estimated at 70% of declared gross (no verified statement).";
            if (hasVerified) r.VerifiedIncome = Math.Round(i.VerifiedNetIncome!.Value);
        }
        else
        {
            var usingVerified = (i.TrustedSalariedIncome ?? 0) > 0;
            primaryNetIncome = usingVerified ? i.TrustedSalariedIncome!.Value : i.GrossIncome;
            r.IncomeBasis = usingVerified ? "verified-salary" : "declared-salary";
            r.IncomeBasisNote = usingVerified
                ? "Bank-verified salary from Income Verification."
                : "Declared gross salary — not yet bank-verified.";
            if (usingVerified) r.VerifiedIncome = i.TrustedSalariedIncome!.Value;
        }

        var combinedIncome = primaryNetIncome + r.CoApplicantIncome;
        r.CombinedIncome = combinedIncome;
        r.IncomeAvailable = combinedIncome > 0;
        r.Cibil = cibil;
        r.PrimaryNetIncome = primaryNetIncome;
        r.RequestedAmount = i.RequestedAmount;
        r.NonBtOutstanding = i.Obligations.Where(o => !o.SelectBT).Sum(o => o.AmountOutstanding);
        r.BtOutstanding = i.Obligations.Where(o => o.SelectBT).Sum(o => o.AmountOutstanding);

        var suggestedFoir = SuggestedFoirFor(loanType, isSelfEmp, combinedIncome, cibil);
        r.SuggestedFoirPct = suggestedFoir;

        var rate = i.InterestRate is >= 6 and <= 36 ? i.InterestRate!.Value : SuggestedRoiFor(loanType, cibil);
        r.ProposedRatePct = rate;
        r.ProposedTenureMonths = tenure;

        // Existing burden: all active non-rejected EMIs. BT ones are refinanced away
        // by the proposed loan, so the RETAINED burden after the loan excludes them.
        var nonBtEmi = i.Obligations.Where(o => !o.SelectBT).Sum(o => o.LoanEmi);
        var btEmi = i.Obligations.Where(o => o.SelectBT).Sum(o => o.LoanEmi);
        r.ExistingNonBtEmi = nonBtEmi;
        r.BalanceTransferEmi = btEmi;
        r.ExistingActiveEmi = nonBtEmi + btEmi;
        r.ActiveObligationCount = i.Obligations.Count;

        if (!r.IncomeAvailable)
        {
            r.DecisionLabel = "FOIR needs the applicant's monthly income — none is on record yet.";
            return r;
        }

        // FOIR — proposed EMI added exactly once (never double-counted).
        r.CurrentFoirPct = Round1(r.ExistingActiveEmi / combinedIncome * 100m);
        r.TotalObligationsAfter = nonBtEmi + r.ProposedEmi;
        r.PostLoanFoirPct = Round1(r.TotalObligationsAfter / combinedIncome * 100m);

        // Capacity FOIR: the user's what-if slider when set (mirrors Vanilla's FOIR
        // slider), else the lender/product limit, else the profile heuristic.
        decimal capacityFoir;
        if (i.FoirOverride is int ov)
        {
            capacityFoir = Math.Min(80, Math.Max(40, ov));
            r.FoirOverrideApplied = true;
            r.CapacityFoirSource = "override";
        }
        else if (i.ApplicableFoirLimitPct.HasValue)
        {
            capacityFoir = i.ApplicableFoirLimitPct.Value;
            r.CapacityFoirSource = "lender";
        }
        else
        {
            capacityFoir = suggestedFoir;
            r.CapacityFoirSource = "suggested";
        }
        r.CapacityFoirPct = capacityFoir;
        r.EligibleEmiAtCapacity = Math.Round(combinedIncome * capacityFoir / 100m, 2);
        r.AvailableHeadroomEmi = Math.Max(0, r.EligibleEmiAtCapacity - nonBtEmi);
        r.EligibleLoanAmount = Math.Round(ReverseEmiPrincipal(r.AvailableHeadroomEmi, rate, tenure), 0);

        // ── Vanilla-parity detail metrics ──────────────────────────────────────────
        r.MaxEligibleLoanAmount = Math.Round(ReverseEmiPrincipal(r.EligibleEmiAtCapacity, rate, tenure), 0);
        r.BtBenefitLoanAmount = Math.Round(ReverseEmiPrincipal(btEmi, rate, tenure), 0);
        r.LoanDiff = (r.EligibleLoanAmount ?? 0) - i.RequestedAmount;
        // CIBIL/loan-type salary multiplier cross-check (Vanilla salaryMultiplier).
        var mult = loanType == "home_loan" ? (cibil >= 750 ? 72 : 60)
            : loanType == "business_loan" ? (cibil >= 750 ? 48 : 36)
            : (cibil >= 750 ? 30 : cibil >= 700 ? 24 : 18);
        r.CibilMultiplier = mult;
        r.LoanByMultiplier = Math.Round(primaryNetIncome * (isSelfEmp ? 0.75m : 1m) * mult / 12m, 0);
        r.ConservativeEligibleLoanAmount = Math.Min(r.EligibleLoanAmount ?? 0, r.LoanByMultiplier);
        // DSCR uses the going (non-BT) EMI, exactly as Vanilla.
        r.Dscr = nonBtEmi > 0 ? (combinedIncome / nonBtEmi).ToString("0.00") : "—";

        if (i.ApplicableFoirLimitPct.HasValue)
        {
            var pass = r.PostLoanFoirPct <= i.ApplicableFoirLimitPct.Value;
            r.PassesLenderLimit = pass;
            r.DecisionLabel = pass
                ? $"Within the {i.ApplicableFoirLimitPct.Value:0.#}% {r.FoirLimitSource} FOIR limit (post-loan {r.PostLoanFoirPct:0.#}%)."
                : $"Exceeds the {i.ApplicableFoirLimitPct.Value:0.#}% {r.FoirLimitSource} FOIR limit (post-loan {r.PostLoanFoirPct:0.#}%).";
        }
        else
        {
            r.PassesLenderLimit = null;
            r.DecisionLabel = $"No lender/product FOIR policy on file — factual FOIR shown (post-loan {r.PostLoanFoirPct:0.#}%). Suggested for this profile: {suggestedFoir}%.";
        }

        return r;
    }

    // ── Heuristics — verbatim port of the former frontend utils/foir.ts (legacy getSuggestedFOIR) ────
    public static int SuggestedFoirFor(string loanType, bool isSelfEmp, decimal income, int cibil)
    {
        double @base = loanType is "home_loan" or "loan_against_property" ? 60
            : loanType == "business_loan" ? 55
            : loanType is "new_car_loan" or "used_car_loan" ? 55
            : 50;
        if (income >= 200000) @base = Math.Min(@base + 15, 75);
        else if (income >= 100000) @base = Math.Min(@base + 10, 70);
        else if (income >= 75000) @base = Math.Min(@base + 5, 65);
        else if (income < 25000) @base = Math.Max(@base - 5, 40);
        if (cibil >= 800) @base = Math.Min(@base + 5, 75);
        else if (cibil >= 750) @base = Math.Min(@base + 2, 72);
        else if (cibil < 650) @base = Math.Max(@base - 8, 40);
        else if (cibil < 675) @base = Math.Max(@base - 4, 42);
        if (isSelfEmp) @base = Math.Max(@base - 3, 40);
        return (int)Math.Min(80, Math.Max(40, Math.Round(@base)));
    }

    private sealed record RoiRule(double Base, (int Min, double R)[] CibilAdj);
    private static readonly Dictionary<string, RoiRule> RoiMatrix = new()
    {
        ["personal_loan"]         = new(14.0, new[] { (750, 11.5), (720, 12.5), (700, 13.5), (675, 15.5), (650, 18.0), (0, 21.0) }),
        ["business_loan"]         = new(15.0, new[] { (750, 12.5), (720, 14.0), (700, 15.5), (675, 17.5), (650, 20.0), (0, 24.0) }),
        ["home_loan"]             = new(9.0,  new[] { (800, 8.4), (750, 8.75), (720, 9.25), (700, 9.75), (675, 10.5), (0, 11.5) }),
        ["loan_against_property"] = new(11.0, new[] { (750, 9.5), (720, 10.5), (700, 11.5), (675, 13.0), (0, 15.0) }),
        ["new_car_loan"]          = new(9.0,  new[] { (750, 7.5), (720, 8.25), (700, 9.0), (675, 10.0), (0, 12.0) }),
        ["used_car_loan"]         = new(13.0, new[] { (750, 11.0), (720, 12.0), (700, 13.0), (675, 15.0), (0, 18.0) }),
        ["education_loan"]        = new(9.5,  new[] { (750, 8.0), (720, 9.0), (700, 9.5), (0, 11.0) }),
        ["over_draft"]            = new(14.0, new[] { (750, 12.0), (720, 13.5), (700, 14.5), (0, 17.0) }),
        ["gold_loan"]             = new(9.5,  new[] { (0, 9.5) }),
        ["tw_loan"]               = new(16.0, new[] { (750, 13.0), (720, 14.5), (700, 16.0), (0, 19.0) }),
    };

    public static decimal SuggestedRoiFor(string loanType, int cibil)
    {
        var m = RoiMatrix.TryGetValue(loanType, out var rule) ? rule : RoiMatrix["personal_loan"];
        foreach (var (min, rr) in m.CibilAdj)
            if (cibil >= min) return (decimal)rr;
        return (decimal)m.Base;
    }

    // Classify employment exactly as the former frontend utils/foir.ts did (strict substring match).
    public static bool IsSelfEmployed(string? employmentType)
    {
        var t = (employmentType ?? string.Empty).ToUpperInvariant();
        return t.Contains("SELF") || t.Contains("SENP") || t.Contains("BUSIN") || t.Contains("PROF");
    }

    /// <summary>Present value of an EMI stream — mirrors utils/emi reverseEmi().principal.</summary>
    public static decimal ReverseEmiPrincipal(decimal emi, decimal ratePercent, int months)
    {
        if (emi <= 0 || months <= 0) return 0m;
        if (ratePercent == 0) return emi * months;
        var r = (double)(ratePercent / 12m / 100m);
        var pv = (double)emi * (1 - Math.Pow(1 + r, -months)) / r;
        return (decimal)pv;
    }

    /// <summary>Standard reducing-balance EMI (EmiCalculator); 0 when there is no principal or tenure.</summary>
    public static decimal CalculateEmi(decimal principal, decimal ratePercent, int months)
    {
        if (months <= 0 || principal <= 0) return 0m;
        return EmiCalculator.ReducingBalance(principal, ratePercent, months);
    }

    private static decimal Round1(decimal v) => Math.Round(v, 1);
}
