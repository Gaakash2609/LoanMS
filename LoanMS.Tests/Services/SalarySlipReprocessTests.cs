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

// Until ebe9e6d every salary slip was read with the wrong storage key and saved
// as an extraction row with no ContentHash ("not found in storage"). Per-document
// dedup skipped those rows forever; they must now be reprocessed in place.
public class SalarySlipReprocessTests
{
    private static AppDbContext Ctx() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static IncomeVerificationService Svc(AppDbContext db, TrustedSalaryExtractionResult result, Mock<ITrustedSalaryExtractionService>? mock = null)
    {
        mock ??= new Mock<ITrustedSalaryExtractionService>();
        mock.Setup(x => x.ExtractAsync(It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>())).ReturnsAsync(result);
        return new IncomeVerificationService(db, new IncomeVerificationEngine(),
            new PerfiosNormalizationService(), mock.Object, NullLogger<IncomeVerificationService>.Instance);
    }

    private static async Task<(int LoanId, int DocId)> SeedAsync(AppDbContext db, string? priorHash)
    {
        var c = new Customer { FullName = "R", Email = $"{Guid.NewGuid():N}@x.com", Phone = "9", MonthlyIncome = 80000 };
        db.Customers.Add(c); await db.SaveChangesAsync();
        var l = new Loan { LoanNumber = "L", CustomerId = c.Id, CreatedByUserId = 1, CreatedAt = new DateTime(2026, 6, 20) };
        db.Loans.Add(l); await db.SaveChangesAsync();
        var d = new LoanDocument { LoanId = l.Id, DocumentName = "Payslip.jpg", DocumentType = "salary_slip", FilePath = $"{l.Id}/p.jpg" };
        db.LoanDocuments.Add(d); await db.SaveChangesAsync();
        db.Add(new SalarySlipExtraction
        {
            LoanId = l.Id, DocumentId = d.Id, ExtractionMethod = "ClientReported", IsTrustedOriginal = false,
            ContentHash = priorHash, UserEditedSalary = 61000, OverrideReason = "manual from slip", EditedByUserId = 5,
        });
        await db.SaveChangesAsync();
        return (l.Id, d.Id);
    }

    private static readonly TrustedSalaryExtractionResult Readable = new()
    {
        IsTrusted = true, ExtractionMethod = "ServerVision", OriginalNetSalary = 62000, MonthLabel = "May 2026", ContentHash = "abc",
    };

    [Fact]
    public async Task NeverReadRow_IsReprocessedInPlace_AndManualOverrideIsKept()
    {
        using var db = Ctx();
        var (loanId, docId) = await SeedAsync(db, priorHash: null);

        await Svc(db, Readable).RunAsync(loanId, new RunIncomeVerificationRequestDto { ApplicantRole = ApplicantRole.Applicant }, 7);

        var row = await db.Set<SalarySlipExtraction>().SingleAsync(s => s.DocumentId == docId);
        row.ContentHash.Should().Be("abc");
        row.ExtractionMethod.Should().Be("ServerVision");
        row.IsTrustedOriginal.Should().BeTrue();
        row.OriginalNetSalary.Should().Be(62000);
        row.Month.Should().Be(5);
        row.UserEditedSalary.Should().Be(61000);          // override preserved
        row.OverrideReason.Should().Be("manual from slip");
        row.EditedByUserId.Should().Be(5);
    }

    [Fact]
    public async Task StillUnreadable_RowIsLeftUntouched()
    {
        using var db = Ctx();
        var (loanId, docId) = await SeedAsync(db, priorHash: null);

        await Svc(db, new TrustedSalaryExtractionResult { IsTrusted = false, ExtractionMethod = "ClientReported", FallbackReason = "not found" })
            .RunAsync(loanId, new RunIncomeVerificationRequestDto { ApplicantRole = ApplicantRole.Applicant }, 7);

        var rows = await db.Set<SalarySlipExtraction>().Where(s => s.DocumentId == docId).ToListAsync();
        rows.Should().ContainSingle();
        rows[0].ContentHash.Should().BeNull();
    }

    [Fact]
    public async Task AlreadyReadRow_IsNotExtractedAgain()
    {
        using var db = Ctx();
        var (loanId, _) = await SeedAsync(db, priorHash: "existing");
        var mock = new Mock<ITrustedSalaryExtractionService>();

        await Svc(db, Readable, mock).RunAsync(loanId, new RunIncomeVerificationRequestDto { ApplicantRole = ApplicantRole.Applicant }, 7);

        mock.Verify(x => x.ExtractAsync(It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
