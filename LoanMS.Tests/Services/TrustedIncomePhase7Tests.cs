using FluentAssertions;
using LoanMS.Application.IncomeVerification;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using LoanMS.Infrastructure.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;
using IncomeVerificationEntity = LoanMS.Domain.Entities.IncomeVerification;

namespace LoanMS.Tests.Services;

// ── Phase 7 locked rule: trusted salaried verified income ─────────────────────
// Verified income is trusted ONLY when AutoVerified, or ManualReviewCompleted +
// Approved. Everything else → null (caller uses declared).
public class TrustedIncomePhase7Tests
{
    private static AppDbContext Ctx() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

    private static IncomeVerificationService Svc(AppDbContext db) =>
        new(db, new IncomeVerificationEngine(), new PerfiosNormalizationService(),
            new Mock<ITrustedSalaryExtractionService>().Object, NullLogger<IncomeVerificationService>.Instance);

    private static async Task Seed(AppDbContext db, IncomeVerificationState state, decimal? verified,
        string? reviewDecision = null, DateTime? runAt = null)
    {
        db.IncomeVerifications.Add(new IncomeVerificationEntity
        {
            LoanId = 1, ApplicantRole = ApplicantRole.Applicant, State = state,
            VerifiedIncome = verified, ReviewDecision = reviewDecision, RunAt = runAt ?? DateTime.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task AutoVerified_ReturnsVerifiedIncome()
    {
        using var db = Ctx();
        await Seed(db, IncomeVerificationState.AutoVerified, 50000);
        (await Svc(db).GetTrustedVerifiedIncomeAsync(1)).Should().Be(50000);
    }

    [Fact]
    public async Task ManualReviewCompleted_Approved_ReturnsVerifiedIncome()
    {
        using var db = Ctx();
        await Seed(db, IncomeVerificationState.ManualReviewCompleted, 48000, reviewDecision: "Approved");
        (await Svc(db).GetTrustedVerifiedIncomeAsync(1)).Should().Be(48000);
    }

    [Theory]
    [InlineData(IncomeVerificationState.Pending)]
    [InlineData(IncomeVerificationState.ManualReviewRequired)]
    [InlineData(IncomeVerificationState.Failed)]
    [InlineData(IncomeVerificationState.LegacyUnverified)]
    public async Task UnverifiedStates_ReturnNull(IncomeVerificationState state)
    {
        using var db = Ctx();
        await Seed(db, state, 50000);   // even if a stray VerifiedIncome is present, the state gate wins
        (await Svc(db).GetTrustedVerifiedIncomeAsync(1)).Should().BeNull();
    }

    [Fact]
    public async Task ManualReviewCompleted_Rejected_ReturnsNull()
    {
        using var db = Ctx();
        await Seed(db, IncomeVerificationState.ManualReviewCompleted, null, reviewDecision: "Rejected");
        (await Svc(db).GetTrustedVerifiedIncomeAsync(1)).Should().BeNull();
    }

    [Fact]
    public async Task NoVerification_ReturnsNull()
    {
        using var db = Ctx();
        (await Svc(db).GetTrustedVerifiedIncomeAsync(1)).Should().BeNull();
    }

    [Fact]
    public async Task LatestRunGoverns()
    {
        using var db = Ctx();
        await Seed(db, IncomeVerificationState.AutoVerified, 50000, runAt: DateTime.UtcNow.AddDays(-1));
        await Seed(db, IncomeVerificationState.ManualReviewRequired, null, runAt: DateTime.UtcNow); // newer
        (await Svc(db).GetTrustedVerifiedIncomeAsync(1)).Should().BeNull();
    }
}
