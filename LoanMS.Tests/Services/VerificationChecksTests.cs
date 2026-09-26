using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Application.Services;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using LoanMS.Tests.TestHelpers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanMS.Tests.Services;

/// <summary>
/// Journey audit 2026-09-26 (AUDIT_PROGRESS.md section J, J-5 / J-6 / J-10):
/// verification flags are the server's record of a recorded check — set by
/// POST /tracking inside the check's stage window, never by a bare browser claim.
/// </summary>
public class VerificationChecksTests
{
    [Theory]
    [InlineData("EFIN — Documents", "Documents check")]
    [InlineData("EFIN- Bank Details Check", "Bank details check")]
    [InlineData("EFIN-Charge", "ECS return check")]
    [InlineData("EFIN- FI report", "FI report")]
    [InlineData("EFIN-Nach", "NACH")]
    [InlineData("EFIN-Customer Agreement", "Customer agreement")]
    public void ForEntry_MapsTheTimelineNameToItsCheck(string entryName, string label) =>
        VerificationChecks.ForEntry(entryName)!.Label.Should().Be(label);

    [Fact]
    public void ForEntry_UnknownOrManualNames_AreNotChecks()
    {
        VerificationChecks.ForEntry("EFIN-Income Check - CPA").Should().BeNull("income is derived from the verification run");
        VerificationChecks.ForEntry("Manual Comment").Should().BeNull();
        VerificationChecks.ForEntry(null).Should().BeNull();
    }

    [Fact]
    public void ParseFiResult_ReadsBothAddresses_AndIgnoresTheFollowUpNote()
    {
        VerificationChecks.ParseFiResult("Final Resi Address - Positive\nFinal Office Address - Pending")
            .Should().Be(("Positive", "Pending"));
        VerificationChecks.ParseFiResult("Final Resi Address - Negative\n Final Office Address - Waived")
            .Should().Be(("Negative", "Waived"));
        VerificationChecks.ParseFiResult("").Should().Be(((string?)null, (string?)null));
    }

    [Theory]
    [InlineData(LoanStatus.OnHold, true)]
    [InlineData(LoanStatus.Disbursed, true)]
    [InlineData(LoanStatus.Closed, true)]
    [InlineData(LoanStatus.Rejected, true)]
    [InlineData(LoanStatus.Submitted, false)]
    [InlineData(LoanStatus.Acceptance, false)]
    public void HeldOrClosedApplications_AreFrozen(LoanStatus s, bool frozen) =>
        VerificationChecks.IsFrozen(s).Should().Be(frozen);

    [Fact]
    public void UnderwritingEntryBlockers_ListsTheMissingCpaChecks()
    {
        var loan = new Loan { DocumentChecked = true, IncomeChecked = false, BankChecked = true, EcsReturn = false };
        LoanService.UnderwritingEntryBlockers(loan).Should().Equal("Income check", "ECS return check");
        loan.IncomeChecked = loan.EcsReturn = true;
        LoanService.UnderwritingEntryBlockers(loan).Should().BeEmpty();
    }

    // ── POST /tracking sets the flag in the same save (in window only) ───────
    private static (TrackingController c, AppDbContext db) Tracking(LoanStatus status, out int loanId)
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var user = new User { Id = 1, FullName = "Admin", Email = "a@x.test", Role = UserRole.Admin, IsActive = true };
        var cust = new Customer { Id = 1, FullName = "Cust", Email = "c@x.test", Phone = "9876543210" };
        var loan = new Loan { Id = 1, LoanNumber = "EFIN1", CustomerId = 1, CreatedByUserId = 1, Status = status, RequestedAmount = 100000, InterestRate = 12, TenureMonths = 24 };
        db.Users.Add(user); db.Customers.Add(cust); db.Loans.Add(loan); db.SaveChanges();
        loanId = loan.Id;
        var claims = new ClaimsIdentity(new[] { new Claim("userId", "1"), new Claim("role", "Admin") }, "Test");
        var c = new TrackingController(db, RolePermissionTestDouble.AllowAll())
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(claims) } },
        };
        return (c, db);
    }

    [Fact]
    public async Task RecordingACheck_SetsItsFlag_InTheSameRequest()
    {
        var (c, db) = Tracking(LoanStatus.Submitted, out var id);
        var r = await c.Add(id, new TrackingDto { Name = "EFIN — Documents", Stage = "Sales Dep", Status = "COMPLETE" });
        r.Should().BeOfType<OkObjectResult>();
        (await db.Loans.AsNoTracking().SingleAsync()).DocumentChecked.Should().BeTrue();
    }

    [Fact]
    public async Task RecordingACheckOutsideItsWindow_KeepsTheNote_ButSetsNoFlag()
    {
        var (c, db) = Tracking(LoanStatus.Offer, out var id);
        await c.Add(id, new TrackingDto { Name = "EFIN- Bank Details Check", Stage = "CEO", Status = "COMPLETE" });
        (await db.TrackingEntries.CountAsync()).Should().Be(1);
        (await db.Loans.AsNoTracking().SingleAsync()).BankChecked.Should().BeFalse("the Bank check window is Draft / Submitted / Under Review");
    }

    [Fact]
    public async Task APendingEntry_IsNotACompletedCheck()
    {
        var (c, db) = Tracking(LoanStatus.Submitted, out var id);
        await c.Add(id, new TrackingDto { Name = "EFIN-Charge", Stage = "Sales Dep", Status = "Pending" });
        (await db.Loans.AsNoTracking().SingleAsync()).EcsReturn.Should().BeFalse();
    }
}
