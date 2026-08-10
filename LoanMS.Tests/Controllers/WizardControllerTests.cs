using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Application.DTOs;
using LoanMS.Application.Interfaces;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using LoanMS.Tests.TestHelpers;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// NOTE ON VERIFICATION: same as IncredControllerTests — this suite could not
/// be executed in the sandbox that produced it (no .NET SDK could be
/// installed there; outbound access to the Microsoft/NuGet package feeds
/// needed for `dotnet build`/`dotnet test` is not on that environment's
/// network allowlist). Written against the actual WizardController.Submit()
/// source (method/field names, DTO shape, entity fields all cross-checked
/// against the real files) but not compiler- or run-verified. Run `dotnet
/// test` locally before relying on these.
///
/// Phase 2 — Wizard Sales Person Assignment: dto.SalesPerson -> User lookup
/// (by FullName, matching the wizard's Sales Person dropdown value) ->
/// Loan.AssignedToUserId, enforced for both Submit() loan-creation branches
/// (new loan, and resuming an existing Draft).
/// </summary>
public class WizardControllerTests
{
    private static (WizardController controller, AppDbContext db) CreateController(int currentUserId = 1, string currentUserRole = "Sales")
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        var db = new AppDbContext(options);

        var cache = new FakeCacheService();

        var claims = new ClaimsIdentity(new[]
        {
            new Claim("userId", currentUserId.ToString()),
            new Claim("role", currentUserRole)
        }, "TestAuth");

        var controller = new WizardController(db, NullLogger<WizardController>.Instance, cache)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(claims) }
            }
        };

        return (controller, db);
    }

    /// <summary>Minimal but Submit()-complete DTO: format-valid, no DSA/Partner/Location mapping.</summary>
    private static WizardSubmitDto CreateValidDto(string? salesPerson) => new()
    {
        FullName    = "Test Applicant",
        Mobile      = "9876543210",
        Email       = "applicant@test.com",
        Amount      = 100000,
        LoanType    = "personal_loan",
        LoanRate    = 12,
        Tenure      = 24,
        SalesPerson = salesPerson
    };

    private static ApiResponseDto<WizardSubmitResponseDto> ExtractResponse(IActionResult result) => result switch
    {
        OkObjectResult ok         => (ApiResponseDto<WizardSubmitResponseDto>)ok.Value!,
        BadRequestObjectResult br => (ApiResponseDto<WizardSubmitResponseDto>)br.Value!,
        NotFoundObjectResult nf   => (ApiResponseDto<WizardSubmitResponseDto>)nf.Value!,
        _ => throw new InvalidOperationException($"Unexpected result type: {result.GetType().Name}")
    };

    // ── New Loan branch ──────────────────────────────────────────────────────

    [Fact]
    public async Task Submit_NewLoan_ValidSalesPerson_SetsCorrectAssignedToUserId()
    {
        var (controller, db) = CreateController();
        var salesUser = new User { FullName = "Ravi Kumar", Email = "ravi@efin.com", Role = UserRole.Sales, IsActive = true };
        db.Users.Add(salesUser);
        await db.SaveChangesAsync();

        var result = await controller.Submit(CreateValidDto("Ravi Kumar"));
        var response = ExtractResponse(result);

        response.Success.Should().BeTrue();
        var loan = await db.Loans.FirstAsync(l => l.Id == response.Data!.LoanId);
        loan.AssignedToUserId.Should().Be(salesUser.Id);
    }

    [Fact]
    public async Task Submit_NewLoan_MissingSalesPerson_Rejected()
    {
        var (controller, _) = CreateController();

        var result = await controller.Submit(CreateValidDto(null));
        var response = ExtractResponse(result);

        result.Should().BeOfType<BadRequestObjectResult>();
        response.Success.Should().BeFalse();
        response.Errors.Should().Contain(e => e.Contains("Sales Person is required"));
    }

    [Fact]
    public async Task Submit_NewLoan_InvalidSalesPerson_Rejected()
    {
        var (controller, _) = CreateController();

        var result = await controller.Submit(CreateValidDto("Nonexistent Person"));
        var response = ExtractResponse(result);

        result.Should().BeOfType<BadRequestObjectResult>();
        response.Success.Should().BeFalse();
        response.Errors.Should().Contain(e => e.Contains("was not found"));
    }

    [Fact]
    public async Task Submit_NewLoan_InactiveSalesPerson_Rejected()
    {
        var (controller, db) = CreateController();
        var inactiveUser = new User { FullName = "Inactive Sales", Email = "inactive@efin.com", Role = UserRole.Sales, IsActive = false };
        db.Users.Add(inactiveUser);
        await db.SaveChangesAsync();

        var result = await controller.Submit(CreateValidDto("Inactive Sales"));
        var response = ExtractResponse(result);

        result.Should().BeOfType<BadRequestObjectResult>();
        response.Success.Should().BeFalse();
        response.Errors.Should().Contain(e => e.Contains("inactive"));
    }

    // ── Existing Draft Resume branch ─────────────────────────────────────────

    [Fact]
    public async Task Submit_ResumeDraft_ValidSalesPerson_SetsCorrectAssignedToUserId()
    {
        var (controller, db) = CreateController();
        var customer = new Customer { FullName = "Draft Cust", Email = "d@t.com", Phone = "9999999999" };
        var draftLoan = new Loan
        {
            LoanNumber = "EFIN2026DRAFT01", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 50000, InterestRate = 12, TenureMonths = 24,
            CustomerId = 0, CreatedByUserId = 1
        };
        db.Customers.Add(customer);
        await db.SaveChangesAsync();
        draftLoan.CustomerId = customer.Id;
        db.Loans.Add(draftLoan);

        var newSalesUser = new User { FullName = "Priya Shah", Email = "priya@efin.com", Role = UserRole.Sales, IsActive = true };
        db.Users.Add(newSalesUser);
        await db.SaveChangesAsync();

        var dto = CreateValidDto("Priya Shah");
        dto.LoanId = draftLoan.Id;

        var result = await controller.Submit(dto);
        var response = ExtractResponse(result);

        response.Success.Should().BeTrue();
        var loan = await db.Loans.FirstAsync(l => l.Id == draftLoan.Id);
        loan.AssignedToUserId.Should().Be(newSalesUser.Id);
    }

    [Fact]
    public async Task Submit_ResumeDraft_MissingSalesPerson_Rejected()
    {
        var (controller, db) = CreateController();
        var customer = new Customer { FullName = "Draft Cust", Email = "d2@t.com", Phone = "9999999998" };
        db.Customers.Add(customer);
        await db.SaveChangesAsync();
        var draftLoan = new Loan
        {
            LoanNumber = "EFIN2026DRAFT02", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 50000, InterestRate = 12, TenureMonths = 24,
            CustomerId = customer.Id, CreatedByUserId = 1
        };
        db.Loans.Add(draftLoan);
        await db.SaveChangesAsync();

        var dto = CreateValidDto(null);
        dto.LoanId = draftLoan.Id;

        var result = await controller.Submit(dto);
        var response = ExtractResponse(result);

        result.Should().BeOfType<BadRequestObjectResult>();
        response.Errors.Should().Contain(e => e.Contains("Sales Person is required"));

        // Draft must remain untouched (still Draft, no assignee) — rejected before the transaction.
        var loan = await db.Loans.FirstAsync(l => l.Id == draftLoan.Id);
        loan.Status.Should().Be(LoanStatus.Draft);
        loan.AssignedToUserId.Should().BeNull();
    }

    [Fact]
    public async Task Submit_ResumeDraft_InvalidSalesPerson_Rejected()
    {
        var (controller, db) = CreateController();
        var customer = new Customer { FullName = "Draft Cust", Email = "d3@t.com", Phone = "9999999997" };
        db.Customers.Add(customer);
        await db.SaveChangesAsync();
        var draftLoan = new Loan
        {
            LoanNumber = "EFIN2026DRAFT03", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 50000, InterestRate = 12, TenureMonths = 24,
            CustomerId = customer.Id, CreatedByUserId = 1
        };
        db.Loans.Add(draftLoan);
        await db.SaveChangesAsync();

        var dto = CreateValidDto("Ghost Person");
        dto.LoanId = draftLoan.Id;

        var result = await controller.Submit(dto);
        var response = ExtractResponse(result);

        result.Should().BeOfType<BadRequestObjectResult>();
        response.Errors.Should().Contain(e => e.Contains("was not found"));
    }

    [Fact]
    public async Task Submit_ResumeDraft_InactiveSalesPerson_Rejected()
    {
        var (controller, db) = CreateController();
        var customer = new Customer { FullName = "Draft Cust", Email = "d4@t.com", Phone = "9999999996" };
        var inactiveUser = new User { FullName = "Old Sales", Email = "old@efin.com", Role = UserRole.Sales, IsActive = false };
        db.Customers.Add(customer);
        db.Users.Add(inactiveUser);
        await db.SaveChangesAsync();
        var draftLoan = new Loan
        {
            LoanNumber = "EFIN2026DRAFT04", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 50000, InterestRate = 12, TenureMonths = 24,
            CustomerId = customer.Id, CreatedByUserId = 1
        };
        db.Loans.Add(draftLoan);
        await db.SaveChangesAsync();

        var dto = CreateValidDto("Old Sales");
        dto.LoanId = draftLoan.Id;

        var result = await controller.Submit(dto);
        var response = ExtractResponse(result);

        result.Should().BeOfType<BadRequestObjectResult>();
        response.Errors.Should().Contain(e => e.Contains("inactive"));
    }
}
