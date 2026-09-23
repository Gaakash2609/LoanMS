using FluentAssertions;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;
using Xunit;

namespace LoanMS.Tests.Services;

/// <summary>
/// A "thin-file" borrower — a real bureau report with no credit accounts, and
/// therefore no payment history — must analyse cleanly rather than throw.
///
/// BureauReport.PaymentHistory is a [NotMapped] computed property that flattens
/// the payment history of every account, so for a report with no accounts it is
/// an EMPTY list, never null. The service guarded it with `?.` only, which does
/// nothing for an empty sequence: Max() then threw
/// InvalidOperationException("Sequence contains no elements"), surfacing as an
/// unhandled HTTP 500 from GET /api/cibil/full-report.
///
/// This was undetectable until the nine Bureau tables existed
/// (20260822000000_AddBureauReportTables) — before that the endpoint failed
/// earlier, on the missing relation.
/// </summary>
public class CibilAnalysisThinFileTests
{
    private static BureauReport ThinFileReport() => new()
    {
        Id = 1,
        CustomerId = 1,
        BureauProvider = "CIBIL",
        CreditScore = 760,
        RiskCategory = "Low",
        ScoreGeneratedDate = DateTime.UtcNow,
        IsActive = true,
        FullName = "Thin File",
        PAN = "THINF1234Z",
        // No Accounts -> PaymentHistory is empty (not null). No Enquiries either.
    };

    [Fact]
    public async Task AnalyzeCibilReport_WithNoAccounts_DoesNotThrow()
    {
        var svc = new CibilAnalysisService();
        var report = ThinFileReport();

        var act = async () => await svc.AnalyzeCibilReport(report);

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task CalculateRiskAnalysis_WithNoAccounts_DoesNotThrow()
    {
        var svc = new CibilAnalysisService();

        var act = async () => await svc.CalculateRiskAnalysis(ThinFileReport());

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task AnalyzeCreditBehaviour_WithNoAccounts_DoesNotThrow()
    {
        var svc = new CibilAnalysisService();

        var act = async () => await svc.AnalyzeCreditBehaviour(ThinFileReport());

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task GenerateAutoInsights_WithNoAccounts_DoesNotThrow()
    {
        var svc = new CibilAnalysisService();

        var act = async () => await svc.GenerateAutoInsights(ThinFileReport());

        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task AnalyzeCibilReport_WithNoAccounts_StillReportsTheScore()
    {
        var svc = new CibilAnalysisService();

        var result = await svc.AnalyzeCibilReport(ThinFileReport());

        result.Should().NotBeNull();
    }
}
