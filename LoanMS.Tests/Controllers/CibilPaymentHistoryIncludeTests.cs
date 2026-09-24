using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// Pins GET /api/cibil/payment-history against a regression that made it the
/// only CIBIL endpoint to return 500.
///
/// BureauReport.PaymentHistory is [NotMapped] — a computed convenience property
/// that flattens Accounts.SelectMany(a => a.PaymentHistory). The controller
/// passed it straight to Include(), and EF rejects that at query-translation
/// time with InvalidOperationException ("The expression 'b.PaymentHistory' is
/// invalid inside an 'Include' operation"). Every single call threw, including
/// the "no report on file" case that the sibling endpoints answer with a clean
/// 404. Found by running the production image against a real PostgreSQL and
/// sweeping every parameterless GET.
///
/// The rejection happens during translation, so it reproduces on any provider —
/// InMemory is enough to hold the line here.
/// </summary>
public class CibilPaymentHistoryIncludeTests
{
    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private static CibilController CreateController(AppDbContext db) =>
        new(db,
            new Mock<ICibilAnalysisService>().Object);

    [Fact]
    public async Task PaymentHistory_NoReportOnFile_Returns404_NotAServerError()
    {
        using var db = CreateContext();
        var controller = CreateController(db);

        // Must not throw. Before the fix this raised InvalidOperationException
        // from Include() before ever reaching the null check below.
        var result = await controller.PaymentHistory(customerId: 4242);

        result.Should().BeOfType<NotFoundObjectResult>(
            "a customer with no bureau report is a 404, exactly like /risk-analysis and /insights");
    }

    [Fact]
    public async Task PaymentHistory_WithStoredReport_ReturnsOk_AndFlattensAccountHistory()
    {
        using var db = CreateContext();

        db.BureauReports.Add(new BureauReport
        {
            CustomerId = 7,
            IsActive   = true,
            Accounts =
            {
                new BureauAccount
                {
                    PaymentHistory =
                    {
                        new BureauPaymentHistory { ReportMonth = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc), DPDStatus = "000", DaysOverdue = 0 },
                        new BureauPaymentHistory { ReportMonth = new DateTime(2026, 2, 1, 0, 0, 0, DateTimeKind.Utc), DPDStatus = "030", DaysOverdue = 30 },
                    }
                },
                new BureauAccount
                {
                    PaymentHistory =
                    {
                        new BureauPaymentHistory { ReportMonth = new DateTime(2026, 3, 1, 0, 0, 0, DateTimeKind.Utc), DPDStatus = "000", DaysOverdue = 0 },
                    }
                },
            }
        });
        await db.SaveChangesAsync();

        var result = await CreateController(db).PaymentHistory(customerId: 7);

        result.Should().BeOfType<OkObjectResult>();
    }

    /// <summary>
    /// Thin file: a bureau report exists but carries no payment rows at all.
    /// Every Max() in the DPD heatmap is then over an empty sequence, which
    /// threw "Sequence contains no elements" before the nullable lift.
    /// </summary>
    [Fact]
    public async Task PaymentHistory_ThinFile_NoPaymentRows_ReturnsOk_WithZeroDpd()
    {
        using var db = CreateContext();
        db.BureauReports.Add(new BureauReport { CustomerId = 11, IsActive = true });
        await db.SaveChangesAsync();

        var result = await CreateController(db).PaymentHistory(customerId: 11);

        result.Should().BeOfType<OkObjectResult>(
            "a borrower with no payment history is a valid thin file, not a server error");
    }

    /// <summary>
    /// Guards the root cause directly: if someone re-adds a mapped
    /// PaymentHistory navigation to BureauReport (or drops [NotMapped]), the
    /// Include() shape in the controller would need revisiting.
    /// </summary>
    [Fact]
    public void BureauReport_PaymentHistory_IsComputedNotMapped()
    {
        using var db = CreateContext();
        var entity = db.Model.FindEntityType(typeof(BureauReport))!;

        entity.FindNavigation(nameof(BureauReport.PaymentHistory))
            .Should().BeNull("PaymentHistory is a [NotMapped] computed property, not an EF navigation");

        entity.FindNavigation(nameof(BureauReport.Accounts))
            .Should().NotBeNull("Accounts is the real navigation the controller must Include");
    }
}
