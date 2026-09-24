using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.API.Services;
using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using LoanMS.Tests.TestHelpers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// Phase 2 RBAC — G-10/G-11 (document verify/reject/replace authorization) and
/// G-08 (auditable Admin stage override). Backend-level, direct-API tests: a
/// hidden button is not authorization, so these exercise the controller methods
/// themselves.
/// </summary>
public class Phase2DocumentAndOverrideTests
{
    private static AppDbContext NewDb() =>
        new(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    private static Mock<ILoanService> LoanServiceWithVisibleLoan()
    {
        var mock = new Mock<ILoanService>();
        mock.Setup(s => s.GetByIdAsync(It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string>(), It.IsAny<HashSet<string>?>()))
            .ReturnsAsync(ApiResponseDto<LoanDto>.Ok(new LoanDto()));
        mock.Setup(s => s.OverrideStatusAsync(It.IsAny<int>(), It.IsAny<LoanStatus>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<string>()))
            .ReturnsAsync(ApiResponseDto<LoanDto>.Ok(new LoanDto()));
        return mock;
    }

    private static LoansController Controller(AppDbContext db, IRolePermissionService perm, ILoanService loanService, string role = "Manager", int userId = 3) =>
        new(loanService, db, Mock.Of<IFileStorageService>(), perm)
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

    private static int SeedDoc(AppDbContext db, string status = "Pending")
    {
        var doc = new LoanDocument { LoanId = 1, DocumentName = "PAN", DocumentType = "identity", FilePath = "1/x.pdf", Status = status };
        db.Set<LoanDocument>().Add(doc);
        db.SaveChanges();
        return doc.Id;
    }

    // ── G-10 verify/reject authorization ─────────────────────────────────────

    [Fact]
    public async Task Verify_Denied_WhenCanVerifyDocsFalse()
    {
        using var db = NewDb();
        var docId = SeedDoc(db);
        var perm = new Mock<IRolePermissionService>();
        perm.Setup(r => r.IsAllowedAsync(It.IsAny<string?>(), "canVerifyDocs")).ReturnsAsync(false);

        var result = await Controller(db, perm.Object, LoanServiceWithVisibleLoan().Object)
            .VerifyDocument(1, docId, new DocumentReviewRequestDto { Note = "ok" });

        result.Should().BeOfType<ForbidResult>();
        db.Set<LoanDocument>().Find(docId)!.Status.Should().Be("Pending");   // unchanged
    }

    [Fact]
    public async Task Verify_Allowed_SetsVerifiedAndReviewer()
    {
        using var db = NewDb();
        var docId = SeedDoc(db);

        var result = await Controller(db, RolePermissionTestDouble.AllowAll(), LoanServiceWithVisibleLoan().Object, userId: 7)
            .VerifyDocument(1, docId, new DocumentReviewRequestDto { Note = "looks good" });

        result.Should().BeOfType<OkObjectResult>();
        var doc = db.Set<LoanDocument>().Find(docId)!;
        doc.Status.Should().Be("Verified");
        doc.ReviewedByUserId.Should().Be("7");
        doc.ReviewedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task Reject_RequiresReason()
    {
        using var db = NewDb();
        var docId = SeedDoc(db);

        var result = await Controller(db, RolePermissionTestDouble.AllowAll(), LoanServiceWithVisibleLoan().Object)
            .RejectDocument(1, docId, new DocumentReviewRequestDto { Note = "   " });

        result.Should().BeOfType<BadRequestObjectResult>();
        db.Set<LoanDocument>().Find(docId)!.Status.Should().Be("Pending");   // unchanged
    }

    [Fact]
    public async Task Reject_WithReason_SetsRejectedAndNote()
    {
        using var db = NewDb();
        var docId = SeedDoc(db);

        var result = await Controller(db, RolePermissionTestDouble.AllowAll(), LoanServiceWithVisibleLoan().Object)
            .RejectDocument(1, docId, new DocumentReviewRequestDto { Note = "Blurred scan" });

        result.Should().BeOfType<OkObjectResult>();
        var doc = db.Set<LoanDocument>().Find(docId)!;
        doc.Status.Should().Be("Rejected");
        doc.ReviewNote.Should().Be("Blurred scan");
    }

    // ── G-08 Admin stage override ────────────────────────────────────────────

    [Fact]
    public async Task Override_RequiresReason()
    {
        using var db = NewDb();
        var loanService = LoanServiceWithVisibleLoan();

        var result = await Controller(db, RolePermissionTestDouble.AllowAll(), loanService.Object, role: "Admin")
            .OverrideStatus(1, new OverrideStatusRequestDto { NewStatus = LoanStatus.Approved, Reason = "" });

        result.Should().BeOfType<BadRequestObjectResult>();
        loanService.Verify(s => s.OverrideStatusAsync(It.IsAny<int>(), It.IsAny<LoanStatus>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<string>()), Times.Never);
        db.AuditLogs.Should().BeEmpty();
    }

    [Fact]
    public async Task Override_WithReason_CallsService_AndWritesStructuredAudit()
    {
        using var db = NewDb();
        var loanService = LoanServiceWithVisibleLoan();

        var result = await Controller(db, RolePermissionTestDouble.AllowAll(), loanService.Object, role: "Admin", userId: 9)
            .OverrideStatus(5, new OverrideStatusRequestDto { NewStatus = LoanStatus.Disbursed, Reason = "Board-approved exception" });

        result.Should().BeOfType<OkObjectResult>();
        loanService.Verify(s => s.OverrideStatusAsync(5, LoanStatus.Disbursed, "Board-approved exception", 9, "Admin"), Times.Once);

        var audit = db.AuditLogs.Single();
        audit.Action.Should().Be("StageOverride");
        audit.EntityName.Should().Be("Loans");
        audit.EntityId.Should().Be("5");
        audit.NewValues.Should().Be("Disbursed");
        audit.Reason.Should().Be("Board-approved exception");
        audit.UserId.Should().Be(9);
    }
    // ── G-11 replace keeps the applicant identity (Gap-2) ─────────────────────

    [Fact]
    public async Task Replace_CoApplicantDocument_KeepsApplicantRoleAndKey()
    {
        using var db = NewDb();
        var old = new LoanDocument { LoanId = 1, DocumentName = "Co slip", DocumentType = "salary_slip", FilePath = "1/old.pdf",
                                     ApplicantRole = ApplicantRole.CoApplicant, ApplicantKey = "co1" };
        db.Set<LoanDocument>().Add(old);
        db.SaveChanges();
        var perm = new Mock<IRolePermissionService>();
        perm.Setup(r => r.IsAllowedAsync(It.IsAny<string?>(), "canUploadDocs")).ReturnsAsync(true);
        var bytes = System.Text.Encoding.ASCII.GetBytes("%PDF-1.4 replacement");
        var file = new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", "Co_slip_v2.pdf") { Headers = new HeaderDictionary(), ContentType = "application/pdf" };

        var result = await Controller(db, perm.Object, LoanServiceWithVisibleLoan().Object).ReplaceDocument(1, old.Id, file);

        result.Should().BeOfType<OkObjectResult>();
        var replacement = db.Set<LoanDocument>().Single(d => d.Id != old.Id);
        replacement.ApplicantRole.Should().Be(ApplicantRole.CoApplicant);
        replacement.ApplicantKey.Should().Be("co1");
        replacement.Version.Should().Be(old.Version + 1);
    }

}
