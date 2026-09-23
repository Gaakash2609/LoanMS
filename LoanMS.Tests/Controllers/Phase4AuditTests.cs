using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using LoanMS.Tests.TestHelpers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// Phase 4 (G-22) — structured before/after audit on sensitive mutations.
/// Verifies payout status change and document verify/reject each write an
/// AuditLog row carrying OldValues → NewValues + Reason (a real before-image,
/// which the global middleware alone did not provide).
/// </summary>
public class Phase4AuditTests
{
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static ControllerContext Ctx(string role, int userId = 3) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim("userId", userId.ToString()),
                new Claim(ClaimTypes.Role, role),
                new Claim(ClaimTypes.Email, "actor@x.com"),
            }, "TestAuth"))
        }
    };

    [Fact]
    public async Task PayoutStatusChange_WritesBeforeAfterAudit()
    {
        using var db = NewDb();
        db.Customers.Add(new Customer { Id = 1, FullName = "C" });
        db.Users.Add(new User { Id = 5, FullName = "Claimant", Email = "c@x.com" });
        db.Loans.Add(new Loan { Id = 1, LoanNumber = "L1", CustomerId = 1, CreatedByUserId = 5 });
        db.PayoutClaims.Add(new PayoutClaim { Id = 1, LoanId = 1, ClaimedByUserId = 5, ClaimType = "Sales", ClaimAmount = 100, Status = "Pending" });
        db.SaveChanges();

        var controller = new PayoutController(db) { ControllerContext = Ctx("Accounts") };
        var result = await controller.UpdateStatus(1, new ClaimStatusDto { Status = "Paid", Notes = "Paid via NEFT" });

        result.Should().BeOfType<OkObjectResult>();
        var audit = db.AuditLogs.Single();
        audit.Action.Should().Be("PayoutStatusChanged");
        audit.EntityName.Should().Be("PayoutClaim");
        audit.OldValues.Should().Be("Pending");
        audit.NewValues.Should().Be("Paid");
        audit.Reason.Should().Be("Paid via NEFT");
        audit.UserId.Should().Be(3);
    }

    private static (LoansController c, AppDbContext db) DocController(string role, int userId = 7)
    {
        var db = NewDb();
        db.Set<LoanDocument>().Add(new LoanDocument { Id = 1, LoanId = 1, DocumentName = "PAN", DocumentType = "identity", FilePath = "1/x.pdf", Status = "Pending" });
        db.SaveChanges();

        var loanService = new Mock<ILoanService>();
        loanService.Setup(s => s.GetByIdAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string>(), It.IsAny<HashSet<string>?>()))
            .ReturnsAsync(ApiResponseDto<LoanDto>.Ok(new LoanDto()));

        var c = new LoansController(loanService.Object, db, Mock.Of<IFileStorageService>(), RolePermissionTestDouble.AllowAll())
        { ControllerContext = Ctx(role, userId) };
        return (c, db);
    }

    [Fact]
    public async Task DocumentVerify_WritesAudit()
    {
        var (c, db) = DocController("Manager");
        var result = await c.VerifyDocument(1, 1, new DocumentReviewRequestDto { Note = "clear" });

        result.Should().BeOfType<OkObjectResult>();
        var audit = db.AuditLogs.Single();
        audit.Action.Should().Be("DocumentVerified");
        audit.OldValues.Should().Be("Pending");
        audit.NewValues.Should().Be("Verified");
        db.Dispose();
    }

    [Fact]
    public async Task DocumentReject_WritesAudit_WithReason()
    {
        var (c, db) = DocController("Manager");
        var result = await c.RejectDocument(1, 1, new DocumentReviewRequestDto { Note = "Blurred scan" });

        result.Should().BeOfType<OkObjectResult>();
        var audit = db.AuditLogs.Single();
        audit.Action.Should().Be("DocumentRejected");
        audit.OldValues.Should().Be("Pending");
        audit.NewValues.Should().Be("Rejected");
        audit.Reason.Should().Be("Blurred scan");
        db.Dispose();
    }
}
