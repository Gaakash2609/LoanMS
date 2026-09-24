using FluentAssertions;
using LoanMS.Application.Obligations;
using LoanMS.Application.Services;
using Xunit;

namespace LoanMS.Tests.Services;

// ── EMI consolidation ────────────────────────────────────────────────────────
// LoansController, WizardController, LoanService and ObligationFoirEngine each
// carried their own copy of the reducing-balance EMI formula; all four now call
// EmiCalculator. These tests pin that the shared helper returns exactly what the
// removed copies returned, and that each caller's own guard is unchanged.
public class EmiCalculatorTests
{
    // Verbatim copy of the formula removed from LoanService and ObligationFoirEngine
    // (WizardController's copy only hoisted Math.Pow into a local — same value).
    private static decimal RemovedServiceCopy(decimal principal, decimal ratePercent, int months)
    {
        if (ratePercent == 0) return Math.Round(principal / months, 2);
        var r   = ratePercent / 12 / 100;
        var emi = principal * r * (decimal)Math.Pow((double)(1 + r), months)
                  / ((decimal)Math.Pow((double)(1 + r), months) - 1);
        return Math.Round(emi, 2);
    }

    // Verbatim copy of the formula removed from LoansController.CalculateEmi. The
    // endpoint kept it unrounded and applied Math.Round(emi, 2) to every figure.
    private static decimal RemovedEndpointCopy(decimal amount, decimal rate, int tenure)
    {
        decimal r = rate / 12 / 100;
        return amount * r * (decimal)Math.Pow((double)(1 + r), tenure)
               / ((decimal)Math.Pow((double)(1 + r), tenure) - 1);
    }

    private static readonly decimal[] Principals =
        { 1000m, 50000m, 100000m, 250000.75m, 600000.50m, 800000m, 1000000m, 2500000m, 7500000.33m, 100000000m };
    private static readonly decimal[] Rates =
        { 0m, 0.1m, 7.5m, 8.4m, 9.75m, 10m, 10.5m, 11.25m, 12m, 13.99m, 18m, 24m, 36m, 100m };
    private static readonly int[] Tenures = { 1, 6, 12, 24, 36, 48, 60, 84, 120, 180, 240, 300, 360 };

    [Fact]
    public void ReducingBalance_EqualsTheRemovedServiceCopies_AcrossTheWholeGrid()
    {
        var checkedCases = 0;
        foreach (var p in Principals)
        foreach (var rate in Rates)
        foreach (var n in Tenures)
        {
            EmiCalculator.ReducingBalance(p, rate, n).Should().Be(RemovedServiceCopy(p, rate, n),
                $"principal {p}, rate {rate}%, {n} months");
            checkedCases++;
        }
        checkedCases.Should().Be(Principals.Length * Rates.Length * Tenures.Length);
    }

    [Fact]
    public void ReducingBalance_EqualsTheRemovedEndpointCopy_ForEveryFigureTheEndpointReturns()
    {
        foreach (var amount in Principals)
        foreach (var rate in Rates.Where(r => r > 0))   // the endpoint returns 400 for rate <= 0
        foreach (var tenure in Tenures)
        {
            var before = RemovedEndpointCopy(amount, rate, tenure);
            var after  = EmiCalculator.ReducingBalance(amount, rate, tenure);

            Math.Round(after, 2).Should().Be(Math.Round(before, 2));                     // monthlyEmi
            (Math.Round(after, 2) * tenure).Should().Be(Math.Round(before, 2) * tenure); // totalPayable
        }
    }

    [Fact]
    public void ZeroRate_IsStraightLinePrincipalOverMonths()
    {
        EmiCalculator.ReducingBalance(120000m, 0m, 12).Should().Be(10000m);
        EmiCalculator.ReducingBalance(100000m, 0m, 7).Should().Be(14285.71m);
    }

    [Fact]
    public void ZeroMonths_StillThrows_ExactlyAsEveryRemovedCopyDid()
    {
        FluentActions.Invoking(() => EmiCalculator.ReducingBalance(100000m, 10m, 0))
            .Should().Throw<DivideByZeroException>();
        FluentActions.Invoking(() => EmiCalculator.ReducingBalance(100000m, 0m, 0))
            .Should().Throw<DivideByZeroException>();
    }

    [Fact]
    public void ObligationFoirEngine_KeepsItsOwnZeroGuard()
    {
        ObligationFoirEngine.CalculateEmi(0m, 10m, 12).Should().Be(0m);
        ObligationFoirEngine.CalculateEmi(-5m, 10m, 12).Should().Be(0m);
        ObligationFoirEngine.CalculateEmi(100000m, 10m, 0).Should().Be(0m);
        ObligationFoirEngine.CalculateEmi(100000m, 10m, -3).Should().Be(0m);
        ObligationFoirEngine.CalculateEmi(600000.50m, 11.25m, 36)
            .Should().Be(RemovedServiceCopy(600000.50m, 11.25m, 36));
    }
}
