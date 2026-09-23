using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// Phase 7B-3 — freshly written backend tests for PerfiosController
/// (bank-statement verification report persistence: GET latest / POST save
/// against PerfiosReport). These are NEW tests written directly against the
/// current PerfiosController/PerfiosReport/DTOs/AppDbContext — not a recovery
/// of any earlier file. Follows this suite's existing
/// Mock&lt;ILoanService&gt; + EF Core InMemory pattern (see
/// Phase2DocumentAndOverrideTests, CibilPaymentHistoryIncludeTests): the loan
/// visibility check is mocked at the ILoanService boundary rather than
/// exercising real scoping logic, and PerfiosReport rows are seeded/asserted
/// directly against an InMemory AppDbContext. No production code changed.
/// </summary>
public class PerfiosControllerTests
{
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    /// <summary>Mocks the ILoanService.GetByIdAsync visibility gate that both
    /// controller actions check before touching PerfiosReport rows.</summary>
    private static Mock<ILoanService> VisibleLoanMock(bool visible)
    {
        var mock = new Mock<ILoanService>();
        mock.Setup(s => s.GetByIdAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string>(), It.IsAny<HashSet<string>?>()))
            .ReturnsAsync(visible
                ? ApiResponseDto<LoanDto>.Ok(new LoanDto())
                : ApiResponseDto<LoanDto>.Fail("Not found"));
        return mock;
    }

    private static Mock<ILoanService> LoanServiceWithVisibleLoan() => VisibleLoanMock(true);

    private static PerfiosController Controller(AppDbContext db, ILoanService loanService, string role = "Sales", int userId = 3) =>
        new(loanService, db, new Mock<IFileStorageService>().Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                    {
                        new Claim("userId", userId.ToString()),
                        new Claim(ClaimTypes.Role, role),
                        new Claim(ClaimTypes.Email, "actor@x.com")
                    }, "TestAuth"))
                }
            }
        };

    private static SavePerfiosReportRequestDto NewRequest(string fileName = "statement.pdf", string? reportDataJson = null) => new()
    {
        FileName = fileName,
        AverageBankBalance = "45,000",
        Span = "6 months",
        TotalTransactions = 120,
        HasSalary = true,
        IsValid = true,
        FirstTransactionDate = "2026-01-01",
        LastTransactionDate = "2026-06-30",
        ManualReviewRequired = false,
        StaleDays = 2,
        ReportDataJson = reportDataJson
    };

    // 1 — Save new report persists row
    [Fact]
    public async Task Save_NewReport_PersistsRow()
    {
        using var db = NewDb();

        var result = await Controller(db, LoanServiceWithVisibleLoan().Object)
            .Save(1, NewRequest());

        result.Should().BeOfType<OkObjectResult>();
        db.PerfiosReports.Should().ContainSingle(r => r.LoanId == 1 && r.FileName == "statement.pdf");
    }

    // 2 — GetLatest returns latest by VerifiedAt
    [Fact]
    public async Task GetLatest_ReturnsMostRecentByVerifiedAt()
    {
        using var db = NewDb();
        db.PerfiosReports.Add(new PerfiosReport { LoanId = 1, FileName = "older.pdf", VerifiedAt = DateTime.UtcNow.AddDays(-2) });
        db.PerfiosReports.Add(new PerfiosReport { LoanId = 1, FileName = "newer.pdf", VerifiedAt = DateTime.UtcNow.AddDays(-1) });
        db.SaveChanges();

        var result = await Controller(db, LoanServiceWithVisibleLoan().Object).GetLatest(1);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ((ApiResponseDto<PerfiosReportDto>)ok.Value!).Data;
        dto!.FileName.Should().Be("newer.pdf");
    }

    // 3 — Save always inserts, never updates
    [Fact]
    public async Task Save_CalledTwice_InsertsTwoRowsNeverUpdatesExisting()
    {
        using var db = NewDb();
        var controller = Controller(db, LoanServiceWithVisibleLoan().Object);

        await controller.Save(1, NewRequest(fileName: "first.pdf"));
        await controller.Save(1, NewRequest(fileName: "second.pdf"));

        db.PerfiosReports.Count(r => r.LoanId == 1).Should().Be(2);
        db.PerfiosReports.Select(r => r.FileName).Should().Contain(new[] { "first.pdf", "second.pdf" });
    }

    // 4 — ReportDataJson round-trip
    [Fact]
    public async Task Save_ThenGetLatest_ReportDataJsonRoundTrips()
    {
        using var db = NewDb();
        var controller = Controller(db, LoanServiceWithVisibleLoan().Object);
        const string json = "{\"txns\":[{\"amt\":100}],\"salary\":true}";

        await controller.Save(1, NewRequest(reportDataJson: json));
        var result = await controller.GetLatest(1);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ((ApiResponseDto<PerfiosReportDto>)ok.Value!).Data;
        dto!.ReportDataJson.Should().Be(json);
    }

    // 5 — Legacy null ReportDataJson works
    [Fact]
    public async Task GetLatest_LegacyRowWithNullReportDataJson_ReturnsOkWithNullJson()
    {
        using var db = NewDb();
        db.PerfiosReports.Add(new PerfiosReport { LoanId = 1, FileName = "legacy.pdf", VerifiedAt = DateTime.UtcNow, ReportDataJson = null });
        db.SaveChanges();

        var result = await Controller(db, LoanServiceWithVisibleLoan().Object).GetLatest(1);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var response = (ApiResponseDto<PerfiosReportDto>)ok.Value!;
        response.Success.Should().BeTrue();
        response.Data!.ReportDataJson.Should().BeNull();
    }

    // 6 — LoanId scoping
    [Fact]
    public async Task GetLatest_OnlyReturnsReportForRequestedLoanId()
    {
        using var db = NewDb();
        db.PerfiosReports.Add(new PerfiosReport { LoanId = 1, FileName = "loan1.pdf", VerifiedAt = DateTime.UtcNow });
        // Newer VerifiedAt but belongs to a different loan — must not leak across LoanId.
        db.PerfiosReports.Add(new PerfiosReport { LoanId = 2, FileName = "loan2.pdf", VerifiedAt = DateTime.UtcNow.AddMinutes(5) });
        db.SaveChanges();

        var result = await Controller(db, LoanServiceWithVisibleLoan().Object).GetLatest(1);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ((ApiResponseDto<PerfiosReportDto>)ok.Value!).Data;
        dto!.FileName.Should().Be("loan1.pdf");
    }

    // 7 — Multiple reports → latest returned, regardless of insertion order
    [Fact]
    public async Task GetLatest_MultipleReports_ReturnsNewestRegardlessOfInsertionOrder()
    {
        using var db = NewDb();
        var now = DateTime.UtcNow;
        db.PerfiosReports.Add(new PerfiosReport { LoanId = 1, FileName = "middle.pdf", VerifiedAt = now.AddHours(-1) });
        db.PerfiosReports.Add(new PerfiosReport { LoanId = 1, FileName = "newest.pdf", VerifiedAt = now });
        db.PerfiosReports.Add(new PerfiosReport { LoanId = 1, FileName = "oldest.pdf", VerifiedAt = now.AddHours(-5) });
        db.SaveChanges();

        var result = await Controller(db, LoanServiceWithVisibleLoan().Object).GetLatest(1);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var dto = ((ApiResponseDto<PerfiosReportDto>)ok.Value!).Data;
        dto!.FileName.Should().Be("newest.pdf");
    }

    // 8 — Save out-of-scope loan → NotFound, no insert
    [Fact]
    public async Task Save_LoanOutOfCallerScope_ReturnsNotFound_AndDoesNotInsert()
    {
        using var db = NewDb();

        var result = await Controller(db, VisibleLoanMock(false).Object).Save(99, NewRequest());

        result.Should().BeOfType<NotFoundObjectResult>();
        db.PerfiosReports.Should().BeEmpty();
    }

    // 9 — GetLatest out-of-scope loan → NotFound
    [Fact]
    public async Task GetLatest_LoanOutOfCallerScope_ReturnsNotFound()
    {
        using var db = NewDb();
        // Row exists, but the caller's visibility scope (mocked below) doesn't cover it —
        // must 404, not leak data past the ILoanService gate.
        db.PerfiosReports.Add(new PerfiosReport { LoanId = 99, FileName = "hidden.pdf", VerifiedAt = DateTime.UtcNow });
        db.SaveChanges();

        var result = await Controller(db, VisibleLoanMock(false).Object).GetLatest(99);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    // 10 — No report on file → successful response with null data
    [Fact]
    public async Task GetLatest_NoReportForVisibleLoan_ReturnsOkWithNullData()
    {
        using var db = NewDb();

        var result = await Controller(db, LoanServiceWithVisibleLoan().Object).GetLatest(1);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var response = (ApiResponseDto<PerfiosReportDto>)ok.Value!;
        response.Success.Should().BeTrue();
        response.Data.Should().BeNull();
    }
}
