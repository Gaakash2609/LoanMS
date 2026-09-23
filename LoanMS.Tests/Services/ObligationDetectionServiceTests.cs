using System.Text.Json;
using FluentAssertions;
using LoanMS.Application.Obligations;
using Xunit;

namespace LoanMS.Tests.Services;

// ── Obligation detection tests ────────────────────────────────────────────────
// Locks the deterministic bank-statement detection: recurring monthly EMI debits
// become candidates; one-offs, same-month pairs, credits and reversals do not; and
// nothing the evidence does not reveal (account number) is invented.
public class ObligationDetectionServiceTests
{
    private readonly ObligationDetectionService _svc = new();

    private static long Ms(int y, int m, int d) =>
        new DateTimeOffset(y, m, d, 0, 0, 0, TimeSpan.Zero).ToUnixTimeMilliseconds();

    private static object Txn(long dateMs, string type, decimal amount, string desc, string category = "") =>
        new { date = dateMs, type, amount, desc, rawDesc = desc, category, balance = 0 };

    private static string Report(object? ach = null, object? ecs = null, object? all = null) =>
        JsonSerializer.Serialize(new
        {
            __v = 1,
            achTxns = ach ?? Array.Empty<object>(),
            ecsTxns = ecs ?? Array.Empty<object>(),
            allTxns = all ?? Array.Empty<object>(),
        });

    [Fact]
    public void RecurringMonthlyDebit_BecomesCandidate_WithCorrectEmiAndCount()
    {
        var json = Report(ach: new[]
        {
            Txn(Ms(2026, 1, 5), "DR", 12000m, "ACH DR HDFC BANK LOAN EMI"),
            Txn(Ms(2026, 2, 5), "DR", 12000m, "ACH DR HDFC BANK LOAN EMI"),
            Txn(Ms(2026, 3, 5), "DR", 12000m, "ACH DR HDFC BANK LOAN EMI"),
            Txn(Ms(2026, 1, 6), "CR", 50000m, "SALARY CREDIT"),   // credit — ignored
        });

        var c = _svc.Detect(json);

        c.Should().HaveCount(1);
        c[0].Emi.Should().Be(12000m);
        c[0].OccurrenceCount.Should().Be(3);
        c[0].Channel.Should().Be("ACH/NACH");
        c[0].FinancerName.Should().NotBeNullOrWhiteSpace();
        c[0].FinancerName!.ToUpperInvariant().Should().Contain("HDFC");
        c[0].AccountNumber.Should().BeNull();       // never invented from a debit narration
        c[0].DetectionSignature.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public void OneOffDebit_IsNotDetected()
    {
        var json = Report(ecs: new[]
        {
            Txn(Ms(2026, 2, 9), "DR", 7777m, "ECS DR BAJAJ FINANCE"),
        });

        _svc.Detect(json).Should().BeEmpty();
    }

    [Fact]
    public void TwoDebitsInSameMonth_AreNotTreatedAsMonthlyEmi()
    {
        var json = Report(ach: new[]
        {
            Txn(Ms(2026, 4, 3), "DR", 5000m, "ACH DR TATA CAPITAL EMI"),
            Txn(Ms(2026, 4, 20), "DR", 5000m, "ACH DR TATA CAPITAL EMI"),
        });

        _svc.Detect(json).Should().BeEmpty();       // needs >= 2 DISTINCT months
    }

    [Fact]
    public void ReturnOrReversal_Narration_IsIgnored()
    {
        var json = Report(ach: new[]
        {
            Txn(Ms(2026, 1, 5), "DR", 9000m, "ACH RETURN ICICI EMI"),
            Txn(Ms(2026, 2, 5), "DR", 9000m, "ACH RETURN ICICI EMI"),
            Txn(Ms(2026, 3, 5), "DR", 9000m, "ACH RETURN ICICI EMI"),
        });

        _svc.Detect(json).Should().BeEmpty();
    }

    [Fact]
    public void GenericLedgerDebit_WithoutEmiNarration_IsNotSwept()
    {
        var json = Report(all: new[]
        {
            Txn(Ms(2026, 1, 5), "DR", 2500m, "UPI SWIGGY", "Shopping"),
            Txn(Ms(2026, 2, 5), "DR", 2500m, "UPI SWIGGY", "Shopping"),
            Txn(Ms(2026, 3, 5), "DR", 2500m, "UPI SWIGGY", "Shopping"),
        });

        _svc.Detect(json).Should().BeEmpty();       // not categorised Loan/EMI, no EMI narration
    }

    [Fact]
    public void LoanCategorisedLedgerDebit_IsDetected()
    {
        var json = Report(all: new[]
        {
            Txn(Ms(2026, 1, 5), "DR", 8000m, "AXIS AUTO LOAN", "Loan/EMI"),
            Txn(Ms(2026, 2, 5), "DR", 8000m, "AXIS AUTO LOAN", "Loan/EMI"),
        });

        var c = _svc.Detect(json);
        c.Should().HaveCount(1);
        c[0].Emi.Should().Be(8000m);
        c[0].Channel.Should().Be("EMI");
    }

    [Fact]
    public void Detection_IsDeterministic_SameInputSameSignature()
    {
        var json = Report(ach: new[]
        {
            Txn(Ms(2026, 1, 5), "DR", 12000m, "ACH DR HDFC BANK LOAN EMI"),
            Txn(Ms(2026, 2, 5), "DR", 12000m, "ACH DR HDFC BANK LOAN EMI"),
        });

        var a = _svc.Detect(json);
        var b = _svc.Detect(json);
        a[0].DetectionSignature.Should().Be(b[0].DetectionSignature);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("[]")]
    public void BadOrEmptyJson_ReturnsEmpty(string? json)
        => _svc.Detect(json).Should().BeEmpty();
}
