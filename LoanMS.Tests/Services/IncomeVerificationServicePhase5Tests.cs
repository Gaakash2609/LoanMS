using FluentAssertions;
using LoanMS.Application.DTOs.IncomeVerification;
using LoanMS.Application.IncomeVerification;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using LoanMS.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace LoanMS.Tests.Services;

// ── Phase 5 orchestration tests (in-memory, end-to-end through the service) ────
public class IncomeVerificationServicePhase5Tests
{
    private static readonly TimeSpan Ist = TimeSpan.FromMinutes(330);
    private static readonly DateTime LoanCreated = new(2026, 6, 20); // → required Mar/Apr/May 2026

    private static AppDbContext Ctx() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static long IstMs(int y, int m, int d) => new DateTimeOffset(y, m, d, 0, 0, 0, Ist).ToUnixTimeMilliseconds();

    private static string ReportJson(params (int y, int m, int d, decimal amt)[] credits)
    {
        var txns = string.Join(",", credits.Select(c =>
            $"{{\"date\":{IstMs(c.y, c.m, c.d)},\"desc\":\"SALARY\",\"rawDesc\":\"SALARY\",\"type\":\"CR\",\"amount\":{c.amt},\"balance\":0,\"category\":\"Salary\"}}"));
        return "{\"__v\":1,\"accountInfo\":{\"bank\":\"HDFC\",\"accountNo\":\"1\",\"periodFrom\":\"01/01/2026\",\"periodTo\":\"30/06/2026\"}," +
               $"\"salaryTxns\":[{txns}],\"neftTxns\":[]}}";
    }

    private static IncomeVerificationService Svc(AppDbContext db, Mock<ITrustedSalaryExtractionService>? extraction = null) =>
        new(db, new IncomeVerificationEngine(), new PerfiosNormalizationService(),
            (extraction ?? new Mock<ITrustedSalaryExtractionService>()).Object,
            NullLogger<IncomeVerificationService>.Instance);

    private static async Task<Loan> SeedLoanAsync(AppDbContext db, decimal declared = 80000)
    {
        var cust = new Customer { FullName = "RAM", Email = "r@x.com", Phone = "9", MonthlyIncome = declared };
        db.Customers.Add(cust);
        await db.SaveChangesAsync();
        var loan = new Loan { LoanNumber = "L1", CustomerId = cust.Id, CreatedByUserId = 1, CreatedAt = LoanCreated };
        db.Loans.Add(loan);
        await db.SaveChangesAsync();
        return loan;
    }

    private static void SeedExtraction(AppDbContext db, int loanId, int y, int m, decimal net, bool trusted = true)
    {
        db.Set<SalarySlipExtraction>().Add(new SalarySlipExtraction
        {
            LoanId = loanId, DocumentId = y * 100 + m, ApplicantRole = ApplicantRole.Applicant,
            Year = y, Month = m, MonthLabel = $"{m}/{y}", OriginalNetSalary = net,
            ExtractionMethod = trusted ? "ServerVision" : "ClientReported", IsTrustedOriginal = trusted,
        });
    }

    private static void SeedPerfios(AppDbContext db, int loanId, string json) =>
        db.Set<PerfiosReport>().Add(new PerfiosReport { LoanId = loanId, ReportDataJson = json, VerifiedAt = DateTime.UtcNow });

    // Gap-1 (service-level negative proof): even when the client posts a Perfios
    // report whose transactions match every slip perfectly, the evidence is
    // client-parsed (EvidenceSource defaults to "ClientParsed"), so the run must
    // route to ManualReviewRequired — a fabricated client transaction can NOT
    // AutoVerify. Persistence/months/audit still work.
    [Fact]
    public async Task Run_ClientParsedEvidence_PerfectMatch_RoutesToManualReview_NotAutoVerified()
    {
        using var db = Ctx();
        var loan = await SeedLoanAsync(db, declared: 80000);
        SeedExtraction(db, loan.Id, 2026, 3, 50000);
        SeedExtraction(db, loan.Id, 2026, 4, 50000);
        SeedExtraction(db, loan.Id, 2026, 5, 50000);
        SeedPerfios(db, loan.Id, ReportJson((2026, 3, 25, 50000), (2026, 4, 25, 50000), (2026, 5, 25, 50000)));
        await db.SaveChangesAsync();

        var res = await Svc(db).RunAsync(loan.Id, new RunIncomeVerificationRequestDto(), userId: 7);

        res.Success.Should().BeTrue();
        res.Data!.State.Should().Be("ManualReviewRequired");     // NOT AutoVerified — client-parsed evidence
        res.Data.VerifiedIncome.Should().BeNull();
        res.Data.Reasons.Should().Contain(r => r.Code == "UntrustedBankEvidence");
        res.Data.DeclaredIncome.Should().Be(80000);
        res.Data.Months.Should().HaveCount(3);
        res.Data.Months.Should().OnlyContain(m => m.MatchStatus == "Matched");   // matching still ran

        (await db.Loans.FindAsync(loan.Id))!.IncomeChecked.Should().BeFalse();    // derived; never auto-verified
        (await db.IncomeVerifications.CountAsync()).Should().Be(1);
        (await db.AuditLogs.CountAsync(a => a.Action == "Run")).Should().Be(1);
    }

    [Fact]
    public async Task Run_WithIdempotencyKey_DoesNotDuplicate()
    {
        using var db = Ctx();
        var loan = await SeedLoanAsync(db);
        SeedExtraction(db, loan.Id, 2026, 3, 50000);
        SeedPerfios(db, loan.Id, ReportJson((2026, 3, 25, 50000)));
        await db.SaveChangesAsync();

        var req = new RunIncomeVerificationRequestDto { IdempotencyKey = "abc" };
        var first = await Svc(db).RunAsync(loan.Id, req, 7);
        var second = await Svc(db).RunAsync(loan.Id, req, 7);

        first.Data!.Id.Should().Be(second.Data!.Id);
        (await db.IncomeVerifications.CountAsync()).Should().Be(1);
    }

    [Fact]
    public async Task Override_PreservesOriginal_AndForcesManualReview()
    {
        using var db = Ctx();
        var loan = await SeedLoanAsync(db);
        SeedExtraction(db, loan.Id, 2026, 3, 50000);
        SeedExtraction(db, loan.Id, 2026, 4, 50000);
        SeedExtraction(db, loan.Id, 2026, 5, 50000);
        SeedPerfios(db, loan.Id, ReportJson((2026, 3, 25, 45000), (2026, 4, 25, 50000), (2026, 5, 25, 50000)));
        await db.SaveChangesAsync();

        var svc = Svc(db);
        var ex = await db.Set<SalarySlipExtraction>().FirstAsync(s => s.Month == 3);
        var ov = await svc.SetSalaryOverrideAsync(loan.Id, ex.Id, new SalaryOverrideRequestDto { UserEditedSalary = 45000, Reason = "typo fix" }, userId: 9);
        ov.Success.Should().BeTrue();

        var reloaded = await db.Set<SalarySlipExtraction>().FindAsync(ex.Id);
        reloaded!.OriginalNetSalary.Should().Be(50000);   // immutable original untouched
        reloaded.UserEditedSalary.Should().Be(45000);
        reloaded.EditedByUserId.Should().Be(9);

        // Even though the bank credit (45000) equals the edited value, it must NOT auto-verify.
        var res = await svc.RunAsync(loan.Id, new RunIncomeVerificationRequestDto(), 7);
        res.Data!.State.Should().Be("ManualReviewRequired");
        res.Data.VerifiedIncome.Should().BeNull();
        (await db.Loans.FindAsync(loan.Id))!.IncomeChecked.Should().BeFalse();
    }

    [Fact]
    public async Task ManualReview_Approved_CompletesAndSetsIncomeChecked()
    {
        using var db = Ctx();
        var loan = await SeedLoanAsync(db);
        SeedExtraction(db, loan.Id, 2026, 3, 50000);         // no Perfios → ManualReviewRequired
        await db.SaveChangesAsync();

        var svc = Svc(db);
        var run = await svc.RunAsync(loan.Id, new RunIncomeVerificationRequestDto(), 7);
        run.Data!.State.Should().Be("ManualReviewRequired");

        var review = await svc.SubmitManualReviewAsync(loan.Id, run.Data.Id,
            new ManualReviewRequestDto { Decision = "Approved", Reason = "verified manually" }, reviewerId: 3);

        review.Success.Should().BeTrue();
        review.Data!.State.Should().Be("ManualReviewCompleted");
        review.Data.ReviewDecision.Should().Be("Approved");
        review.Data.ReviewedByUserId.Should().Be(3);
        (await db.Loans.FindAsync(loan.Id))!.IncomeChecked.Should().BeTrue();
    }

    [Fact]
    public async Task ManualReview_RequiresReasonAndValidDecision()
    {
        using var db = Ctx();
        var loan = await SeedLoanAsync(db);
        SeedExtraction(db, loan.Id, 2026, 3, 50000);
        await db.SaveChangesAsync();
        var svc = Svc(db);
        var run = await svc.RunAsync(loan.Id, new RunIncomeVerificationRequestDto(), 7);

        (await svc.SubmitManualReviewAsync(loan.Id, run.Data!.Id, new ManualReviewRequestDto { Decision = "Approved", Reason = "" }, 3))
            .Success.Should().BeFalse();
        (await svc.SubmitManualReviewAsync(loan.Id, run.Data.Id, new ManualReviewRequestDto { Decision = "Maybe", Reason = "x" }, 3))
            .Success.Should().BeFalse();
    }

    [Fact]
    public async Task Run_ExtractsFromSalarySlipDocument_ViaExtractionService()
    {
        using var db = Ctx();
        var loan = await SeedLoanAsync(db);
        db.LoanDocuments.Add(new LoanDocument { LoanId = loan.Id, DocumentName = "March Payslip.jpg", DocumentType = "salary_slip", FilePath = "k/march.jpg" });
        await db.SaveChangesAsync();

        var extraction = new Mock<ITrustedSalaryExtractionService>();
        extraction.Setup(x => x.ExtractAsync(It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TrustedSalaryExtractionResult
            {
                IsTrusted = true, ExtractionMethod = "ServerVision", OriginalNetSalary = 50000, MonthLabel = "Apr 2026", ContentHash = "h",
            });

        await Svc(db, extraction).RunAsync(loan.Id, new RunIncomeVerificationRequestDto(), 7);

        var row = await db.Set<SalarySlipExtraction>().SingleAsync();
        row.OriginalNetSalary.Should().Be(50000);
        row.IsTrustedOriginal.Should().BeTrue();
        row.Year.Should().Be(2026);
        row.Month.Should().Be(4);
    }
}
