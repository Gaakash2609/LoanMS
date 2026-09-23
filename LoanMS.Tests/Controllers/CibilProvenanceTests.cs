using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Application.DTOs;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Moq;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// Pins the CIBIL provenance rule: a score is reported as coming from a bureau
/// ONLY when it was read from a stored BureauReport, and a locally derived
/// figure is never written onto the customer record.
///
/// Before the fix, GET /api/cibil/check derived a score from the PAN string,
/// returned it as Source = "Bureau", and saved it over Customer.CibilScore —
/// the field an operator fills in from a real bureau report during the wizard
/// (WizardController.cs:262) and that AIService reads back for underwriting
/// insight. Opening the CIBIL screen for a PAN therefore destroyed the real
/// value. These tests fail if either half of that regresses.
/// </summary>
public class CibilProvenanceTests
{
    private const string Pan = "ABCDE1234F";

    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private static CibilController CreateController(AppDbContext db) =>
        new(db,
            new ConfigurationBuilder().Build(),
            new Mock<ICibilAnalysisService>().Object);

    private static CibilCheckResponseDto Unwrap(IActionResult result)
    {
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var envelope = ok.Value.Should().BeOfType<ApiResponseDto<CibilCheckResponseDto>>().Subject;
        envelope.Data.Should().NotBeNull();
        return envelope.Data!;
    }

    [Fact]
    public async Task Check_WithNoBureauReport_ReportsEstimated_AndLeavesCustomerScoreUntouched()
    {
        var db = CreateContext();
        // 742 stands in for a score an operator transcribed from a real bureau
        // report during the wizard.
        db.Customers.Add(new Customer
        {
            Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001",
            PanNumber = Pan, CibilScore = 742,
        });
        await db.SaveChangesAsync();

        var response = Unwrap(await CreateController(db).Check(Pan, null, null));

        response.IsEstimated.Should().BeTrue();
        response.Source.Should().Be("Estimated");
        response.Source.Should().NotBe("Bureau");

        // The operator-entered score must survive the call untouched.
        var customer = await db.Customers.FirstAsync(c => c.PanNumber == Pan);
        customer.CibilScore.Should().Be(742);
    }

    [Fact]
    public async Task Check_WithActiveBureauReport_ReportsBureau_AndPersistsThatScore()
    {
        var db = CreateContext();
        db.Customers.Add(new Customer
        {
            Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001",
            PanNumber = Pan, CibilScore = 0,
        });
        db.BureauReports.Add(new BureauReport
        {
            Id = 1, CustomerId = 1, CreditScore = 806, IsActive = true,
            ScoreGeneratedDate = DateTime.UtcNow, BureauProvider = "CIBIL",
        });
        await db.SaveChangesAsync();

        var response = Unwrap(await CreateController(db).Check(Pan, null, null));

        response.IsEstimated.Should().BeFalse();
        response.Source.Should().Be("Bureau");
        response.CibilScore.Should().Be(806);

        // A genuine bureau score IS allowed to update the customer record.
        var customer = await db.Customers.FirstAsync(c => c.PanNumber == Pan);
        customer.CibilScore.Should().Be(806);
    }

    [Fact]
    public async Task Check_PrefersTheMostRecentActiveBureauReport()
    {
        var db = CreateContext();
        db.Customers.Add(new Customer
        {
            Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001",
            PanNumber = Pan,
        });
        db.BureauReports.AddRange(
            new BureauReport
            {
                Id = 1, CustomerId = 1, CreditScore = 700, IsActive = true,
                ScoreGeneratedDate = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                BureauProvider = "CIBIL",
            },
            new BureauReport
            {
                Id = 2, CustomerId = 1, CreditScore = 780, IsActive = true,
                ScoreGeneratedDate = new DateTime(2026, 6, 1, 0, 0, 0, DateTimeKind.Utc),
                BureauProvider = "CIBIL",
            });
        await db.SaveChangesAsync();

        var response = Unwrap(await CreateController(db).Check(Pan, null, null));

        response.CibilScore.Should().Be(780);
        response.IsEstimated.Should().BeFalse();
    }

    [Fact]
    public async Task Check_IgnoresAnInactiveBureauReport()
    {
        var db = CreateContext();
        db.Customers.Add(new Customer
        {
            Id = 1, FullName = "C1", Email = "c1@t.com", Phone = "9000000001",
            PanNumber = Pan, CibilScore = 655,
        });
        db.BureauReports.Add(new BureauReport
        {
            Id = 1, CustomerId = 1, CreditScore = 810, IsActive = false,
            ScoreGeneratedDate = DateTime.UtcNow, BureauProvider = "CIBIL",
        });
        await db.SaveChangesAsync();

        var response = Unwrap(await CreateController(db).Check(Pan, null, null));

        // Superseded report — treat as no bureau data rather than as a pull.
        response.IsEstimated.Should().BeTrue();
        response.Source.Should().Be("Estimated");

        var customer = await db.Customers.FirstAsync(c => c.PanNumber == Pan);
        customer.CibilScore.Should().Be(655);
    }
}
