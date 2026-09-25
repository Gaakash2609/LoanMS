using FluentAssertions;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;

namespace LoanMS.Tests.OfferWorkflow;

public class DeviationRuleEngineTests
{
    private static readonly DateTime Now = new(2026, 9, 25, 10, 0, 0, DateTimeKind.Utc);
    private static int _id;

    private static DeviationRule R(string type, string metric, decimal limit, int bank = 1, int priority = 100, string conds = "[]",
        string logic = "AND", DateTime? from = null, DateTime? to = null, string? product = null, decimal? maxApprovable = null,
        bool active = true, DateTime? superseded = null, bool approvalRequired = true) => new()
    {
        Id = ++_id, RuleKey = "K" + _id, Version = 1, Name = $"{type}-{_id}", BankId = bank, ProductKey = product, DeviationType = type,
        Metric = metric, LimitValue = limit, Priority = priority, ConditionsJson = conds, ConditionLogic = logic,
        EffectiveFrom = from ?? Now.AddDays(-10), EffectiveTo = to, MaxApprovableDeviation = maxApprovable, IsActive = active,
        SupersededAt = superseded, ApprovalRequired = approvalRequired,
    };

    private static DeviationRuleEngine.Facts F(decimal amount = 500000, int tenure = 36, decimal baseRoi = 13, decimal roi = 12,
        decimal? income = 100000, decimal? foir = 40, int? bureau = 760, int? declared = null, int bank = 1, string product = "personal_loan",
        decimal bt = 0, string? emp = "SALARIED") => new()
    {
        BankId = bank, ProductKey = product, LoanType = "Personal", AsOf = Now, LoanAmount = amount, TenureMonths = tenure,
        BaseRoi = baseRoi, OfferedRoi = roi, MonthlyIncome = income, PostLoanFoirPct = foir, BureauCibil = bureau,
        DeclaredCibil = declared, BtAmount = bt, EmploymentType = emp,
    };

    [Fact]
    public void NoRuleForLender_IsManualReview_FailClosed()
    {
        var ev = DeviationRuleEngine.Evaluate(new[] { R("ROI", "ROI_MIN_PCT", 10, bank: 2) }, F(bank: 1));
        ev.Outcome.Should().Be("Required");
        ev.ManualReview.Should().BeTrue();
    }

    [Fact]
    public void LenderSpecific_HdfcRuleDoesNotAffectIcici()
    {
        var rules = new[] { R("ROI", "ROI_MIN_PCT", 14, bank: 1), R("ROI", "ROI_MIN_PCT", 10, bank: 2) };
        DeviationRuleEngine.Evaluate(rules, F(bank: 1, roi: 12)).Outcome.Should().Be("Required");
        DeviationRuleEngine.Evaluate(rules, F(bank: 2, roi: 12)).Outcome.Should().Be("NotRequired");
    }

    [Theory]
    [InlineData(12, 1.0, "Within")]   // 13 - 12 = 1pp discount, limit 1pp
    [InlineData(11.5, 1.0, "Breach")] // 1.5pp > 1pp
    public void RoiDiscount_IsPercentagePointsBelowBaseRoi(decimal offered, decimal limitPp, string expected)
    {
        var ev = DeviationRuleEngine.Evaluate(new[] { R("ROI", "ROI_DISCOUNT_PP", limitPp) }, F(baseRoi: 13, roi: offered));
        var c = ev.Checks.Single();
        c.Status.Should().Be(expected);
        c.Actual.Should().Be(13 - offered);
        c.Unit.Should().Contain("percentage points");
        if (expected == "Breach") c.Difference.Should().Be(0.5m);
    }

    [Fact]
    public void RoiDiscount_WithoutBaseRoi_IsMissingData()
    {
        var ev = DeviationRuleEngine.Evaluate(new[] { R("ROI", "ROI_DISCOUNT_PP", 1) }, F(baseRoi: 0));
        ev.Checks.Single().Status.Should().Be("MissingData");
        ev.Outcome.Should().Be("Required");
    }

    [Fact]
    public void Foir_MissingIncome_IsMissingData_NeverAssumed()
    {
        var ev = DeviationRuleEngine.Evaluate(new[] { R("FOIR", "FOIR_MAX_PCT", 50) }, F(foir: null));
        ev.Checks.Single().Status.Should().Be("MissingData");
        ev.Outcome.Should().Be("Required");
    }

    [Theory]
    [InlineData(45, "Within")]
    [InlineData(55, "Breach")]
    public void Foir_ComparedToLenderLimit(decimal foir, string expected) =>
        DeviationRuleEngine.Evaluate(new[] { R("FOIR", "FOIR_MAX_PCT", 50) }, F(foir: foir)).Checks.Single().Status.Should().Be(expected);

    [Fact]
    public void Cibil_DeclaredScoreIsNotUsed_OnlyBureau()
    {
        var ev = DeviationRuleEngine.Evaluate(new[] { R("CIBIL", "CIBIL_MIN", 700) }, F(bureau: null, declared: 800));
        var c = ev.Checks.Single();
        c.Status.Should().Be("MissingData");
        c.Message.Should().Contain("declared score 800").And.Contain("not used");
        ev.FactsUsed["cibilSource"].Should().Be("declared (not used)");
    }

    [Theory]
    [InlineData(760, "Within")]
    [InlineData(640, "Breach")]
    public void Cibil_BureauScore(int bureau, string expected) =>
        DeviationRuleEngine.Evaluate(new[] { R("CIBIL", "CIBIL_MIN", 700) }, F(bureau: bureau)).Checks.Single().Status.Should().Be(expected);

    [Fact]
    public void IncomeMultiple_And_Tenure_Metrics()
    {
        var rules = new[] { R("LoanAmount", "INCOME_MULTIPLE_MAX", 4), R("Tenure", "TENURE_MAX_MONTHS", 60), R("Tenure", "TENURE_MIN_MONTHS", 12) };
        var ev = DeviationRuleEngine.Evaluate(rules, F(amount: 500000, income: 100000, tenure: 72));
        ev.Checks.Single(c => c.Metric == "INCOME_MULTIPLE_MAX").Should().Match<DeviationRuleEngine.CheckResult>(c => c.Status == "Breach" && c.Actual == 5m);
        ev.Checks.Single(c => c.Metric == "TENURE_MAX_MONTHS").Status.Should().Be("Breach");
        ev.Checks.Single(c => c.Metric == "TENURE_MIN_MONTHS").Status.Should().Be("Within");
    }

    [Fact]
    public void TieBreak_LowerPriorityNumberWins()
    {
        var ev = DeviationRuleEngine.Evaluate(new[] { R("ROI", "ROI_MIN_PCT", 14, priority: 50), R("ROI", "ROI_MIN_PCT", 10, priority: 10) }, F(roi: 12));
        ev.Checks.Single().Allowed.Should().Be(10);
    }

    [Fact]
    public void TieBreak_SameePriority_MoreSpecificWins()
    {
        var general = R("ROI", "ROI_MIN_PCT", 14);
        var specific = R("ROI", "ROI_MIN_PCT", 10, conds: "[{\"field\":\"loanAmount\",\"op\":\"gte\",\"value\":\"100000\"}]");
        DeviationRuleEngine.Evaluate(new[] { general, specific }, F(roi: 12)).Checks.Single().Allowed.Should().Be(10);
    }

    [Fact]
    public void TieBreak_SameSpecificity_LatestEffectiveFromWins()
    {
        var older = R("ROI", "ROI_MIN_PCT", 14, from: Now.AddDays(-20));
        var newer = R("ROI", "ROI_MIN_PCT", 10, from: Now.AddDays(-5));
        DeviationRuleEngine.Evaluate(new[] { older, newer }, F(roi: 12)).Checks.Single().Allowed.Should().Be(10);
    }

    [Fact]
    public void TieBreak_ExactTie_IsConflictError_NotRandom()
    {
        var from = Now.AddDays(-5);
        var ev = DeviationRuleEngine.Evaluate(new[] { R("ROI", "ROI_MIN_PCT", 14, from: from), R("ROI", "ROI_MIN_PCT", 10, from: from) }, F(roi: 12));
        var c = ev.Checks.Single();
        c.Status.Should().Be("Conflict");
        c.ConflictingRuleIds.Should().HaveCount(2);
        ev.Outcome.Should().Be("Required");
    }

    [Fact]
    public void Conditions_AndOr()
    {
        var and = R("FOIR", "FOIR_MAX_PCT", 50, conds: "[{\"field\":\"employmentType\",\"op\":\"eq\",\"value\":\"SALARIED\"},{\"field\":\"loanAmount\",\"op\":\"gt\",\"value\":\"1000000\"}]");
        DeviationRuleEngine.Evaluate(new[] { and }, F(amount: 500000)).Checks.Should().BeEmpty("AND fails on amount → rule not applicable");
        var or = R("FOIR", "FOIR_MAX_PCT", 50, logic: "OR", conds: "[{\"field\":\"employmentType\",\"op\":\"eq\",\"value\":\"SALARIED\"},{\"field\":\"loanAmount\",\"op\":\"gt\",\"value\":\"1000000\"}]");
        DeviationRuleEngine.Evaluate(new[] { or }, F(amount: 500000)).Checks.Should().ContainSingle();
    }

    [Fact]
    public void Condition_OnMissingFact_IsMissingData()
    {
        var r = R("ROI", "ROI_MIN_PCT", 10, conds: "[{\"field\":\"cibil\",\"op\":\"gte\",\"value\":\"750\"}]");
        var ev = DeviationRuleEngine.Evaluate(new[] { r }, F(bureau: null));
        ev.Checks.Single().Status.Should().Be("MissingData");
    }

    [Fact]
    public void FreshVsBt_Condition()
    {
        var r = R("ROI", "ROI_MIN_PCT", 14, conds: "[{\"field\":\"loanPurpose\",\"op\":\"eq\",\"value\":\"BT\"}]");
        DeviationRuleEngine.Evaluate(new[] { r }, F(roi: 12, bt: 0)).Checks.Should().BeEmpty();
        DeviationRuleEngine.Evaluate(new[] { r }, F(roi: 12, bt: 200000)).Checks.Single().Status.Should().Be("Breach");
    }

    [Fact]
    public void InactiveExpiredFutureOrSupersededRules_AreIgnored()
    {
        var rules = new[]
        {
            R("ROI", "ROI_MIN_PCT", 14, active: false),
            R("ROI", "ROI_MIN_PCT", 14, to: Now.AddDays(-1)),
            R("ROI", "ROI_MIN_PCT", 14, from: Now.AddDays(1)),
            R("ROI", "ROI_MIN_PCT", 14, superseded: Now.AddDays(-2)),
        };
        DeviationRuleEngine.Evaluate(rules, F(roi: 12)).ManualReview.Should().BeTrue("no rule is in force");
    }

    [Fact]
    public void AuthorityLimit_FlagsBreachBeyondApprovable()
    {
        var ev = DeviationRuleEngine.Evaluate(new[] { R("ROI", "ROI_MIN_PCT", 12, maxApprovable: 0.5m) }, F(roi: 11));
        ev.Checks.Single().ExceedsAuthority.Should().BeTrue();
    }

    [Fact]
    public void BreachOnRuleNotRequiringApproval_DoesNotRequireDeviation()
    {
        var ev = DeviationRuleEngine.Evaluate(new[] { R("ROI", "ROI_MIN_PCT", 14, approvalRequired: false) }, F(roi: 12));
        ev.Checks.Single().Status.Should().Be("Breach");
        ev.Outcome.Should().Be("NotRequired");
    }

    [Fact]
    public void ProductSpecificRule_OnlyForThatProduct()
    {
        var r = R("ROI", "ROI_MIN_PCT", 14, product: "home_loan");
        DeviationRuleEngine.Evaluate(new[] { r }, F(product: "personal_loan")).ManualReview.Should().BeTrue();
    }

    // ── Save-time validation ────────────────────────────────────────────────
    [Fact]
    public void Validate_RejectsGlobalRule_BadMetric_BadDates_DuplicateCondition()
    {
        var bad = R("ROI", "FOIR_MAX_PCT", 10, bank: 0, to: Now.AddDays(-30),
            conds: "[{\"field\":\"loanAmount\",\"op\":\"gt\",\"value\":\"1\"},{\"field\":\"loanAmount\",\"op\":\"gt\",\"value\":\"1\"}]");
        var errors = DeviationRuleEngine.ValidateRule(bad, Array.Empty<DeviationRule>());
        errors.Should().Contain(e => e.Contains("global rules are not allowed"));
        errors.Should().Contain(e => e.Contains("Metric for ROI"));
        errors.Should().Contain(e => e.Contains("Effective To"));
        errors.Should().Contain(e => e.Contains("Duplicate condition"));
    }

    [Fact]
    public void Validate_RejectsOverlappingEquivalentRule_AllowsDifferentPriority()
    {
        var existing = R("ROI", "ROI_MIN_PCT", 12, priority: 10);
        var clash = R("ROI", "ROI_MIN_PCT", 11, priority: 10);
        DeviationRuleEngine.ValidateRule(clash, new[] { existing }).Should().Contain(e => e.Contains("Overlaps"));
        var ok = R("ROI", "ROI_MIN_PCT", 11, priority: 20);
        DeviationRuleEngine.ValidateRule(ok, new[] { existing }).Should().BeEmpty();
    }

    [Fact]
    public void Validate_ManualOnlyCategory_IsNotRuleDriven()
    {
        DeviationRuleEngine.ValidateRule(R("Document", "AMOUNT_MAX", 1), Array.Empty<DeviationRule>())
            .Should().Contain(e => e.Contains("manual-only categories are not rule-driven"));
    }
}

public class OfferTermsCalculatorTests
{
    private static OfferTermsCalculator.Input I(decimal amt = 500000, int n = 36, decimal roi = 12, decimal pf = 1, decimal gst = 18,
        decimal ins = 5000, bool pfB = false, bool insB = false, decimal bt = 0, decimal stamp = 500) => new()
    {
        LoanAmount = amt, TenureMonths = n, OfferedRoi = roi, ProcessingFeePct = pf, GstPct = gst, InsuranceAmount = ins,
        PfInBundled = pfB, InsuranceInBundled = insB, BtAmount = bt, StampDuty = stamp,
    };

    [Fact]
    public void Unbundled_FeesAreDeducted_EmiOnLoanAmount()
    {
        var r = OfferTermsCalculator.Calculate(I());
        r.ProcessingFeeAmount.Should().Be(5000m);
        r.GstAmount.Should().Be(900m);
        r.FinancedPrincipal.Should().Be(500000m);
        r.Emi.Should().Be(EmiCalculator.ReducingBalance(500000m, 12m, 36));
        r.Emi.Should().Be(16607.15m);
        r.NetDisbursement.Should().Be(500000m - 5000m - 900m - 5000m - 500m);
    }

    [Fact]
    public void Bundled_FeesAndInsuranceAreFinanced_LegacyLaAutoCalcRule()
    {
        var r = OfferTermsCalculator.Calculate(I(pfB: true, insB: true));
        r.FinancedPrincipal.Should().Be(500000m + 5900m + 5000m);
        r.Emi.Should().Be(EmiCalculator.ReducingBalance(510900m, 12m, 36));
        r.NetDisbursement.Should().Be(500000m - 500m);
    }

    [Fact]
    public void BalanceTransfer_IsDeductedFromNetDisbursement()
    {
        OfferTermsCalculator.Calculate(I(bt: 200000)).NetDisbursement.Should().Be(500000m - 5900m - 5000m - 500m - 200000m);
    }

    [Fact]
    public void ZeroRate_IsStraightLine()
    {
        OfferTermsCalculator.Calculate(I(roi: 0, n: 10, amt: 100000, pf: 0, ins: 0, stamp: 0)).Emi.Should().Be(10000m);
    }

    [Fact]
    public void Validate_RejectsNonsense_AndMoreThanTwoDecimals()
    {
        OfferTermsCalculator.Validate(I(amt: 0)).Should().NotBeEmpty();
        OfferTermsCalculator.Validate(I(n: 0)).Should().NotBeEmpty();
        OfferTermsCalculator.Validate(I(roi: 12.345m)).Should().Contain(e => e.Contains("2 decimal"));
        OfferTermsCalculator.Validate(I(ins: -1)).Should().NotBeEmpty();
        OfferTermsCalculator.Validate(I()).Should().BeEmpty();
    }
}
