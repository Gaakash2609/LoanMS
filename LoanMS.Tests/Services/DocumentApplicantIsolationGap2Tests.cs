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

// ── Gap-2: applicant/co-applicant source-document isolation ───────────────────
// The salary document's own ApplicantRole (not the run order) decides which
// applicant's verification may consume it.
public class DocumentApplicantIsolationGap2Tests
{
    private static AppDbContext Ctx() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static IncomeVerificationService Svc(AppDbContext db)
    {
        var extraction = new Mock<ITrustedSalaryExtractionService>();
        extraction.Setup(x => x.ExtractAsync(It.IsAny<string>(), It.IsAny<string?>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TrustedSalaryExtractionResult
            {
                IsTrusted = true, ExtractionMethod = "ServerVision",
                OriginalNetSalary = 50000, MonthLabel = "Apr 2026", ContentHash = "h",
            });
        return new IncomeVerificationService(db, new IncomeVerificationEngine(),
            new PerfiosNormalizationService(), extraction.Object, NullLogger<IncomeVerificationService>.Instance);
    }

    private static async Task<int> SeedLoanAsync(AppDbContext db)
    {
        var c = new Customer { FullName = "R", Email = $"{Guid.NewGuid():N}@x.com", Phone = "9", MonthlyIncome = 80000 };
        db.Customers.Add(c); await db.SaveChangesAsync();
        var l = new Loan { LoanNumber = "L", CustomerId = c.Id, CreatedByUserId = 1, CreatedAt = new DateTime(2026, 6, 20) };
        db.Loans.Add(l); await db.SaveChangesAsync();
        return l.Id;
    }

    private static void SeedDoc(AppDbContext db, int loanId, ApplicantRole role) =>
        db.LoanDocuments.Add(new LoanDocument
        {
            LoanId = loanId, DocumentName = "Payslip.jpg", DocumentType = "salary_slip",
            FilePath = $"k/{Guid.NewGuid():N}.jpg", ApplicantRole = role,
        });

    private static RunIncomeVerificationRequestDto Run(ApplicantRole role) =>
        new() { ApplicantRole = role };

    private static Task<int> PrimaryExtractions(AppDbContext db) =>
        db.Set<SalarySlipExtraction>().CountAsync(s => s.ApplicantRole == ApplicantRole.Applicant);
    private static Task<int> CoAppExtractions(AppDbContext db) =>
        db.Set<SalarySlipExtraction>().CountAsync(s => s.ApplicantRole == ApplicantRole.CoApplicant);

    [Fact] // (1) Primary document → Primary verification = allowed
    public async Task PrimaryDocument_PrimaryRun_IsConsumed()
    {
        using var db = Ctx();
        var loanId = await SeedLoanAsync(db);
        SeedDoc(db, loanId, ApplicantRole.Applicant);
        await db.SaveChangesAsync();

        await Svc(db).RunAsync(loanId, Run(ApplicantRole.Applicant), 7);

        (await PrimaryExtractions(db)).Should().Be(1);
        (await CoAppExtractions(db)).Should().Be(0);
    }

    [Fact] // (2) Primary document → CoApplicant verification = MUST NOT be consumed
    public async Task PrimaryDocument_CoApplicantRun_IsNotConsumed()
    {
        using var db = Ctx();
        var loanId = await SeedLoanAsync(db);
        SeedDoc(db, loanId, ApplicantRole.Applicant);   // ONLY a primary document exists
        await db.SaveChangesAsync();

        await Svc(db).RunAsync(loanId, Run(ApplicantRole.CoApplicant), 7);

        // The primary document must never be pulled into a co-applicant verification.
        (await CoAppExtractions(db)).Should().Be(0);
        (await db.Set<SalarySlipExtraction>().CountAsync()).Should().Be(0);
    }

    [Fact] // (3) CoApplicant document → CoApplicant verification = allowed
    public async Task CoApplicantDocument_CoApplicantRun_IsConsumed()
    {
        using var db = Ctx();
        var loanId = await SeedLoanAsync(db);
        SeedDoc(db, loanId, ApplicantRole.CoApplicant);
        await db.SaveChangesAsync();

        await Svc(db).RunAsync(loanId, Run(ApplicantRole.CoApplicant), 7);

        (await CoAppExtractions(db)).Should().Be(1);
        (await PrimaryExtractions(db)).Should().Be(0);
    }

    [Fact] // (4) Primary and CoApplicant extraction dedup remain independent
    public async Task PrimaryAndCoApplicant_DedupIndependent()
    {
        using var db = Ctx();
        var loanId = await SeedLoanAsync(db);
        SeedDoc(db, loanId, ApplicantRole.Applicant);
        SeedDoc(db, loanId, ApplicantRole.CoApplicant);
        await db.SaveChangesAsync();

        var svc = Svc(db);
        await svc.RunAsync(loanId, Run(ApplicantRole.Applicant), 7);      // → 1 primary extraction
        await svc.RunAsync(loanId, Run(ApplicantRole.CoApplicant), 7);    // → 1 co-app extraction
        await svc.RunAsync(loanId, Run(ApplicantRole.Applicant), 7);      // re-run: dedup, no new primary

        (await PrimaryExtractions(db)).Should().Be(1);   // dedup held within primary scope
        (await CoAppExtractions(db)).Should().Be(1);     // co-applicant unaffected
        (await db.Set<SalarySlipExtraction>().CountAsync()).Should().Be(2);
    }

    [Fact] // (5) CoApplicant document → Primary verification = MUST NOT be consumed (symmetric to #2)
    public async Task CoApplicantDocument_PrimaryRun_IsNotConsumed()
    {
        using var db = Ctx();
        var loanId = await SeedLoanAsync(db);
        SeedDoc(db, loanId, ApplicantRole.CoApplicant);   // ONLY a co-applicant document exists
        await db.SaveChangesAsync();

        await Svc(db).RunAsync(loanId, Run(ApplicantRole.Applicant), 7);

        // The co-applicant document must never be pulled into the PRIMARY verification.
        (await PrimaryExtractions(db)).Should().Be(0);
        (await db.Set<SalarySlipExtraction>().CountAsync()).Should().Be(0);
    }
}
