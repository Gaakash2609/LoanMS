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

// ── Gap-3: required-months reference date = earliest ToStatus=Submitted event ──
// (else loan.CreatedAt). NOT the earliest history row (Draft→Draft creation),
// NOT the current date.
public class SubmitDateReferenceGap3Tests
{
    private static AppDbContext Ctx() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static IncomeVerificationService Svc(AppDbContext db) =>
        new(db, new IncomeVerificationEngine(), new PerfiosNormalizationService(),
            new Mock<ITrustedSalaryExtractionService>().Object, NullLogger<IncomeVerificationService>.Instance);

    private static async Task<int> SeedLoanAsync(AppDbContext db, DateTime createdAt)
    {
        var c = new Customer { FullName = "R", Email = $"{Guid.NewGuid():N}@x.com", Phone = "9", MonthlyIncome = 50000 };
        db.Customers.Add(c); await db.SaveChangesAsync();
        var l = new Loan { LoanNumber = "L", CustomerId = c.Id, CreatedByUserId = 1, CreatedAt = createdAt };
        db.Loans.Add(l); await db.SaveChangesAsync();
        return l.Id;
    }

    private static void SeedHistory(AppDbContext db, int loanId, LoanStatus from, LoanStatus to, DateTime at) =>
        db.LoanStatusHistories.Add(new LoanStatusHistory
        {
            LoanId = loanId, FromStatus = from, ToStatus = to, ChangedByUserId = 1, CreatedAt = at,
        });

    private static async Task<DateTime> RefDateAsync(AppDbContext db, int loanId)
    {
        var res = await Svc(db).RunAsync(loanId, new RunIncomeVerificationRequestDto(), 7);
        return res.Data!.RequiredMonthsReferenceDate;
    }

    [Fact]
    public async Task UsesSubmittedEvent_NotCreation()
    {
        using var db = Ctx();
        var created = new DateTime(2026, 1, 1);
        var submitted = new DateTime(2026, 6, 20);
        var loanId = await SeedLoanAsync(db, created);
        SeedHistory(db, loanId, LoanStatus.Draft, LoanStatus.Draft, created);        // creation (must NOT be used)
        SeedHistory(db, loanId, LoanStatus.Draft, LoanStatus.Submitted, submitted);  // submission
        await db.SaveChangesAsync();

        (await RefDateAsync(db, loanId)).Should().Be(submitted);
    }

    [Fact]
    public async Task FallsBackToCreatedAt_WhenNeverSubmitted()
    {
        using var db = Ctx();
        var created = new DateTime(2026, 3, 10);
        var loanId = await SeedLoanAsync(db, created);
        SeedHistory(db, loanId, LoanStatus.Draft, LoanStatus.Draft, created);   // only a creation row
        await db.SaveChangesAsync();

        (await RefDateAsync(db, loanId)).Should().Be(created);
    }

    [Fact]
    public async Task UsesEarliestSubmission_WhenMultiple()
    {
        using var db = Ctx();
        var created = new DateTime(2026, 1, 1);
        var loanId = await SeedLoanAsync(db, created);
        SeedHistory(db, loanId, LoanStatus.Draft, LoanStatus.Submitted, new DateTime(2026, 5, 1));       // first submission
        SeedHistory(db, loanId, LoanStatus.Rejected, LoanStatus.Submitted, new DateTime(2026, 8, 1));    // re-submission
        await db.SaveChangesAsync();

        (await RefDateAsync(db, loanId)).Should().Be(new DateTime(2026, 5, 1));
    }

    [Fact]
    public async Task ReRun_IsStable_NoDrift()
    {
        using var db = Ctx();
        var loanId = await SeedLoanAsync(db, new DateTime(2026, 1, 1));
        SeedHistory(db, loanId, LoanStatus.Draft, LoanStatus.Submitted, new DateTime(2026, 6, 20));
        await db.SaveChangesAsync();

        var first = await RefDateAsync(db, loanId);
        var second = await RefDateAsync(db, loanId);
        first.Should().Be(new DateTime(2026, 6, 20));
        second.Should().Be(first);   // identical on re-run — no dependence on current date
    }
}
