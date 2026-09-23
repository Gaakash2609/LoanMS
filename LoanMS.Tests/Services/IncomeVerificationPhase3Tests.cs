using FluentAssertions;
using LoanMS.Application.IncomeVerification;
using Xunit;

namespace LoanMS.Tests.Services;

// ── Phase 3 trusted-input unit tests ──────────────────────────────────────────
// Proves the two PURE Phase-3 components behave, so their correctness is
// evidenced (not just "it compiles"): the canonical salary-slip parser (port of
// the client parser) and the Perfios ReportDataJson normalizer.
public class IncomeVerificationPhase3Tests
{
    // ── SalarySlipTextParser ──────────────────────────────────────────────────
    [Fact]
    public void ParseAmount_StripsCurrency_AndIndianGrouping()
    {
        SalarySlipTextParser.ParseAmount("₹1,00,000").Should().Be(100000m);
        SalarySlipTextParser.ParseAmount("Rs. 48,500.50").Should().Be(48500.50m);
        SalarySlipTextParser.ParseAmount(null).Should().Be(0m);
        SalarySlipTextParser.ParseAmount("n/a").Should().Be(0m);
    }

    [Fact]
    public void Parse_ReadsNetFromLabelledLine()
    {
        var r = SalarySlipTextParser.Parse("Employee: A\nGross Salary: 70,000\nNet Pay: Rs. 50,000\n");
        r.NetPay.Should().Be(50000m);
        r.Gross.Should().Be(70000m);
    }

    [Fact]
    public void Parse_FlatFallback_TakeHome()
    {
        // Mirrors the client parser test: "Take Home: Rs. 48,500" → 48500.
        SalarySlipTextParser.Parse("Take Home: Rs. 48,500").NetPay.Should().Be(48500m);
    }

    [Fact]
    public void DetectSalaryMonth_PrefersForMonthOfPhrase()
    {
        SalarySlipTextParser.Parse("Salary Slip for the month of April 2026\nNet Pay 50000").Month.Should().Be("Apr 2026");
        SalarySlipTextParser.DetectSalaryMonth("no month here").Should().BeNull();
    }

    // ── PerfiosNormalizationService ───────────────────────────────────────────
    private static long Ms(int y, int m, int d) =>
        new DateTimeOffset(y, m, d, 0, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds();

    private static string SampleReportJson() =>
        $$"""
        {
          "__v": 1,
          "valid": true,
          "manualReviewRequired": false,
          "accountInfo": { "bank": "HDFC", "accountNo": "12345", "name": "RAM KUMAR", "pan": "ABCDE1234F",
                           "periodFrom": "01/03/2026", "periodTo": "30/04/2026" },
          "salaryTxns": [
            { "date": {{Ms(2026,4,25)}}, "desc": "SALARY APR", "rawDesc": "NEFT SALARY APR", "type": "CR", "amount": 50000, "balance": 60000, "category": "Salary" },
            { "date": {{Ms(2026,4,10)}}, "desc": "ATM WDL", "rawDesc": "ATM", "type": "DR", "amount": 5000, "balance": 55000, "category": "Cash" }
          ],
          "neftTxns": [
            { "date": {{Ms(2026,3,26)}}, "desc": "NEFT RETURN CR", "rawDesc": "NEFT RETURN CR", "type": "CR", "amount": 50000, "balance": 50000, "category": "Transfer" }
          ]
        }
        """;

    [Fact]
    public void Normalize_ExtractsOnlyCredits_FromSalaryAndNeft()
    {
        var svc = new PerfiosNormalizationService();
        var norm = svc.Normalize(SampleReportJson(), sourcePerfiosReportId: 7);

        norm.Should().NotBeNull();
        norm!.SourcePerfiosReportId.Should().Be(7);
        // 2 CR candidates (salary CR + neft CR); the DR is excluded.
        norm.SalaryCreditCandidates.Should().HaveCount(2);
        norm.SalaryCreditCandidates.Should().OnlyContain(t => t.Type == "CR");
        norm.SalaryCreditCandidates.Select(t => t.Amount).Should().OnlyContain(a => a == 50000m);
        norm.HolderName.Should().Be("RAM KUMAR");
        norm.Pan.Should().Be("ABCDE1234F");
    }

    [Fact]
    public void Normalize_CoverageFromStatementPeriod_WhenPresent()
    {
        var norm = new PerfiosNormalizationService().Normalize(SampleReportJson());
        norm!.CoverageSource.Should().Be("StatementPeriod");
        norm.CoverageStart.Should().Be(new DateTime(2026, 3, 1));
        norm.CoverageEnd.Should().Be(new DateTime(2026, 4, 30));
    }

    [Fact]
    public void Normalize_FlagsReturnReversal_ByNarration()
    {
        var norm = new PerfiosNormalizationService().Normalize(SampleReportJson());
        var neft = norm!.SalaryCreditCandidates.Single(t => t.Section == "NEFT");
        neft.IsPossibleReturnOrReversal.Should().BeTrue();   // "NEFT RETURN CR"
        var sal = norm.SalaryCreditCandidates.Single(t => t.Section == "Salary");
        sal.IsPossibleReturnOrReversal.Should().BeFalse();
    }

    [Fact]
    public void Normalize_ReturnsNull_OnBlankOrCorruptJson()
    {
        var svc = new PerfiosNormalizationService();
        svc.Normalize(null).Should().BeNull();
        svc.Normalize("").Should().BeNull();
        svc.Normalize("{ not json").Should().BeNull();
    }

    [Fact]
    public void ComputeReportHash_IsDeterministic_64HexChars()
    {
        var svc = new PerfiosNormalizationService();
        var json = SampleReportJson();
        var h1 = svc.ComputeReportHash(json);
        var h2 = svc.ComputeReportHash(json);
        h1.Should().Be(h2);
        h1.Should().MatchRegex("^[0-9a-f]{64}$");
        svc.ComputeReportHash(json + " ").Should().NotBe(h1);
    }
}
