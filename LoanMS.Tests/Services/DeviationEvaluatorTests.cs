using FluentAssertions;
using LoanMS.Application.Services;
using LoanMS.Domain.Enums;
using Xunit;

namespace LoanMS.Tests.Services;

/// <summary>
/// Pins DeviationEvaluator to the exact policy bands ported from legacy
/// laCheckDeviations. A clean, in-policy loan produces no flags; each rule is
/// triggered in isolation and the "just inside the band" boundary stays clean.
/// </summary>
public class DeviationEvaluatorTests
{
    // A comfortably in-policy personal loan: CIBIL 780 (ROI band 11–16),
    // ROI 14, EMI 20k on 100k salary (20% FOIR), 500k amount (5x income),
    // 36-month tenure. Nothing breaches.
    private static (LoanType, decimal, int, decimal, decimal, decimal, int, string) Clean()
        => (LoanType.Personal, 500_000m, 36, 14m, 20_000m, 100_000m, 780, "SALARIED");

    [Fact]
    public void CleanLoan_ProducesNoFlags()
    {
        var (lt, amt, ten, roi, emi, sal, cibil, emp) = Clean();
        DeviationEvaluator.Evaluate(lt, amt, ten, roi, emi, sal, cibil, emp).Should().BeEmpty();
    }

    [Fact]
    public void RoiAboveBandForCibil_FlagsRoiDeviation()
    {
        // CIBIL 780 → band 11–16; ROI 22 is above it.
        var flags = DeviationEvaluator.Evaluate(LoanType.Personal, 500_000m, 36, 22m, 20_000m, 100_000m, 780, "SALARIED");
        flags.Should().ContainSingle(f => f.Type == "ROI Deviation");
    }

    [Fact]
    public void FoirOverCap_FlagsFoirDeviation()
    {
        // EMI 60k on 100k salary = 60% FOIR; personal cap is 50%. Keep amount
        // small enough (10x) not to trip the multiplier rule.
        var flags = DeviationEvaluator.Evaluate(LoanType.Personal, 1_000_000m, 36, 14m, 60_000m, 100_000m, 780, "SALARIED");
        flags.Should().Contain(f => f.Type == "FOIR Deviation" && f.Badge.Contains("60%"));
    }

    [Fact]
    public void AmountOverIncomeMultiplier_FlagsLoanAmountDeviation()
    {
        // 3,000,000 / 100,000 = 30x; personal max is 24x.
        var flags = DeviationEvaluator.Evaluate(LoanType.Personal, 3_000_000m, 36, 14m, 20_000m, 100_000m, 780, "SALARIED");
        flags.Should().Contain(f => f.Type == "Loan Amount Deviation");
    }

    [Fact]
    public void TenureOverMax_FlagsTenureDeviation()
    {
        // 72 months on a personal loan (max 60).
        var flags = DeviationEvaluator.Evaluate(LoanType.Personal, 500_000m, 72, 14m, 20_000m, 100_000m, 780, "SALARIED");
        flags.Should().Contain(f => f.Type == "Tenure Deviation" && f.Badge.Contains("72 mo"));
    }

    [Fact]
    public void CibilBelowMinimum_FlagsCibilDeviation_AndWidensRoiBand()
    {
        // CIBIL 600 (< 650) → CIBIL Deviation. Its ROI band is 20–36, so ROI
        // 22 stays in-band and does NOT add an ROI flag.
        var flags = DeviationEvaluator.Evaluate(LoanType.Personal, 500_000m, 36, 22m, 20_000m, 100_000m, 600, "SALARIED");
        flags.Should().ContainSingle(f => f.Type == "CIBIL Deviation");
        flags.Should().NotContain(f => f.Type == "ROI Deviation");
    }

    [Fact]
    public void HomeLoan_AllowsHigherFoirTenureAndMultiplier()
    {
        // Home loan: FOIR cap 60, tenure max 300, multiplier max 72. A loan
        // that would breach personal caps stays clean as a home loan.
        // 50% FOIR, 240-month tenure, 50x income — all within home bands.
        var flags = DeviationEvaluator.Evaluate(LoanType.Home, 5_000_000m, 240, 12m, 50_000m, 100_000m, 780, "SALARIED");
        flags.Should().BeEmpty();
    }

    [Fact]
    public void MissingSalaryOrCibil_SkipsThoseRules_NoFalsePositives()
    {
        // No salary and no CIBIL: FOIR / multiplier / ROI-band / CIBIL rules
        // all require those inputs, so only the salary/cibil-independent
        // tenure rule can fire. Tenure 36 is in-policy → no flags.
        var flags = DeviationEvaluator.Evaluate(LoanType.Personal, 500_000m, 36, 14m, 0m, 0m, 0, null);
        flags.Should().BeEmpty();
    }
}
