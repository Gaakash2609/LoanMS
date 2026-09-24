using System.Text.Json;
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
using Microsoft.EntityFrameworkCore.Diagnostics;   // InMemoryEventId
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
        // WizardController.Submit wraps its work in a real transaction
        // (WizardController.cs:346, BeginTransactionAsync). The EF Core InMemory
        // provider has no transaction support and, by default, escalates that to
        // a thrown TransactionIgnoredWarning — which aborted these tests before
        // they reached a single assertion. Suppressing the warning is the remedy
        // EF documents for exactly this case: the transaction is a no-op here,
        // while against PostgreSQL it behaves normally. This changes only the
        // test fixture; the controller is untouched.
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        var db = new AppDbContext(options);

        var cache = new FakeCacheService();

        var claims = new ClaimsIdentity(new[]
        {
            new Claim("userId", currentUserId.ToString()),
            new Claim("role", currentUserRole)
        }, "TestAuth");

        var controller = new WizardController(db, NullLogger<WizardController>.Instance, cache, RolePermissionTestDouble.AllowAll(),
            new LoanMS.API.Services.LoginUserAssignmentService(db))
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

    // ── Loan-type mapping ────────────────────────────────────────────────────
    // Regression guard for the Overdraft gap: the frontend product key
    // "over_draft" must map to LoanType.Overdraft, not silently fall back to
    // LoanType.Personal (which is what happened before the enum value and the
    // _loanTypeMap entry were added). Loan.LoanType persists as a string
    // (HasConversion<string>), so this also confirms "Overdraft" is a valid
    // stored value needing no migration.

    [Fact]
    public async Task Submit_OverdraftProductKey_StoresLoanTypeOverdraft()
    {
        var (controller, db) = CreateController();
        var salesUser = new User { FullName = "OD Sales", Email = "od@efin.com", Role = UserRole.Sales, IsActive = true };
        db.Users.Add(salesUser);
        await db.SaveChangesAsync();

        var dto = CreateValidDto("OD Sales");
        dto.LoanType = "over_draft";

        var result = await controller.Submit(dto);
        var response = ExtractResponse(result);

        response.Success.Should().BeTrue();
        var loan = await db.Loans.FirstAsync(l => l.Id == response.Data!.LoanId);
        loan.LoanType.Should().Be(LoanType.Overdraft);
    }

    [Theory]
    [InlineData("personal_loan", LoanType.Personal)]
    [InlineData("business_loan", LoanType.Business)]
    [InlineData("over_draft",    LoanType.Overdraft)]
    [InlineData("lap",           LoanType.LAP)]
    public async Task Submit_MapsProductKeyToExpectedLoanType(string productKey, LoanType expected)
    {
        var (controller, db) = CreateController();
        var salesUser = new User { FullName = "Map Sales", Email = "map@efin.com", Role = UserRole.Sales, IsActive = true };
        db.Users.Add(salesUser);
        await db.SaveChangesAsync();

        var dto = CreateValidDto("Map Sales");
        dto.LoanType = productKey;

        var result = await controller.Submit(dto);
        var response = ExtractResponse(result);

        response.Success.Should().BeTrue();
        var loan = await db.Loans.FirstAsync(l => l.Id == response.Data!.LoanId);
        loan.LoanType.Should().Be(expected);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Visibility / IDOR — ListDrafts, GetDraft, Submit(resume), SaveDraft
    //
    // All four share the same rule: a Draft belongs to its creator; only
    // that creator, or an Admin/Manager, may see or act on it. These tests
    // pin that rule down at each of the four surfaces so none of them can
    // silently regress back to leaking/accepting another user's draft id.
    // ═══════════════════════════════════════════════════════════════════════

    private static Loan SeedDraft(AppDbContext db, int createdByUserId, string suffix, bool creatorDeleted = false)
    {
        // Loans.CreatedByUserId is a real FK on PostgreSQL — the creator row
        // must exist (ListDrafts projects CreatedBy.Email through it).
        if (!db.Users.IgnoreQueryFilters().Any(u => u.Id == createdByUserId))
        {
            db.Users.Add(new User { Id = createdByUserId, FullName = $"Creator {createdByUserId}", Email = $"creator{createdByUserId}@t.com", PasswordHash = "x", Role = UserRole.Sales, IsActive = true, IsDeleted = creatorDeleted });
            db.SaveChanges();
        }
        var customer = new Customer { FullName = $"Draft Owner {suffix}", Email = $"owner{suffix}@t.com", Phone = $"90000000{suffix}" };
        db.Customers.Add(customer);
        db.SaveChanges();
        var draft = new Loan
        {
            LoanNumber = $"EFIN2026DFT{suffix}", LoanType = LoanType.Personal, Status = LoanStatus.Draft,
            RequestedAmount = 50000, InterestRate = 12, TenureMonths = 24,
            CustomerId = customer.Id, CreatedByUserId = createdByUserId
        };
        db.Loans.Add(draft);
        db.SaveChanges();
        return draft;
    }

    private static JsonElement ExtractListDraftsData(IActionResult result)
    {
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var response = (ApiResponseDto<object>)ok.Value!;
        var json = System.Text.Json.JsonSerializer.Serialize(response.Data);
        return System.Text.Json.JsonDocument.Parse(json).RootElement;
    }

    [Fact]
    public async Task ListDrafts_NonInternalRole_OnlySeesOwnDrafts()
    {
        var (controller, db) = CreateController(currentUserId: 1, currentUserRole: "Sales");
        var own    = SeedDraft(db, createdByUserId: 1, suffix: "01");
        var foreign = SeedDraft(db, createdByUserId: 2, suffix: "02");

        var result = await controller.ListDrafts();
        var data = ExtractListDraftsData(result);

        data.GetArrayLength().Should().Be(1);
        data[0].GetProperty("loanId").GetInt32().Should().Be(own.Id);
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("Manager")]
    public async Task ListDrafts_InternalRole_SeesEveryDraft(string role)
    {
        var (controller, db) = CreateController(currentUserId: 99, currentUserRole: role);
        SeedDraft(db, createdByUserId: 1, suffix: "03");
        SeedDraft(db, createdByUserId: 2, suffix: "04");

        var result = await controller.ListDrafts();
        var data = ExtractListDraftsData(result);

        data.GetArrayLength().Should().Be(2);
    }

    [Fact]
    public async Task ListDrafts_CreatorSoftDeleted_DraftStillListedForAdmin()
    {
        // Regression: the User soft-delete filter turned the required
        // Loan.CreatedBy navigation into an INNER JOIN, so drafts created by a
        // deleted user silently vanished from the Admin/Manager drafts list.
        var (controller, db) = CreateController(currentUserId: 99, currentUserRole: "Admin");
        var draft = SeedDraft(db, createdByUserId: 7, suffix: "07", creatorDeleted: true);

        var result = await controller.ListDrafts();
        var data = ExtractListDraftsData(result);

        data.GetArrayLength().Should().Be(1);
        data[0].GetProperty("loanId").GetInt32().Should().Be(draft.Id);
        data[0].GetProperty("createdByUserEmail").GetString().Should().Be("creator7@t.com");
    }

    [Fact]
    public async Task GetDraft_NonInternalRole_ForeignDraft_ReturnsNotFound()
    {
        var (controller, db) = CreateController(currentUserId: 1, currentUserRole: "Sales");
        var foreign = SeedDraft(db, createdByUserId: 2, suffix: "05");

        var result = await controller.GetDraft(foreign.Id);

        result.Should().BeOfType<NotFoundObjectResult>();
    }

    [Fact]
    public async Task GetDraft_Owner_ReturnsOwnDraft()
    {
        var (controller, db) = CreateController(currentUserId: 1, currentUserRole: "Sales");
        var own = SeedDraft(db, createdByUserId: 1, suffix: "06");

        var result = await controller.GetDraft(own.Id);

        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var response = (ApiResponseDto<WizardSubmitDto>)ok.Value!;
        response.Data!.LoanId.Should().Be(own.Id);
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("Manager")]
    public async Task GetDraft_InternalRole_CanAccessForeignDraft(string role)
    {
        var (controller, db) = CreateController(currentUserId: 99, currentUserRole: role);
        var foreign = SeedDraft(db, createdByUserId: 1, suffix: "07");

        var result = await controller.GetDraft(foreign.Id);

        result.Should().BeOfType<OkObjectResult>();
    }

    [Fact]
    public async Task Submit_ResumeDraft_NonInternalRole_ForeignDraft_ReturnsNotFound_AndLeavesItUntouched()
    {
        var (controller, db) = CreateController(currentUserId: 1, currentUserRole: "Sales");
        var foreign = SeedDraft(db, createdByUserId: 2, suffix: "08");
        var salesUser = new User { FullName = "Map Sales2", Email = "map2@efin.com", Role = UserRole.Sales, IsActive = true };
        db.Users.Add(salesUser);
        await db.SaveChangesAsync();

        var dto = CreateValidDto("Map Sales2");
        dto.LoanId = foreign.Id;

        var result = await controller.Submit(dto);

        result.Should().BeOfType<NotFoundObjectResult>();
        var untouched = await db.Loans.FirstAsync(l => l.Id == foreign.Id);
        untouched.Status.Should().Be(LoanStatus.Draft);
        untouched.CreatedByUserId.Should().Be(2);
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("Manager")]
    public async Task Submit_ResumeDraft_InternalRole_CanSubmitForeignDraft(string role)
    {
        var (controller, db) = CreateController(currentUserId: 99, currentUserRole: role);
        var foreign = SeedDraft(db, createdByUserId: 1, suffix: "09");
        var salesUser = new User { FullName = "Map Sales3", Email = "map3@efin.com", Role = UserRole.Sales, IsActive = true };
        db.Users.Add(salesUser);
        await db.SaveChangesAsync();

        var dto = CreateValidDto("Map Sales3");
        dto.LoanId = foreign.Id;

        var result = await controller.Submit(dto);
        var response = ExtractResponse(result);

        response.Success.Should().BeTrue();
        var loan = await db.Loans.FirstAsync(l => l.Id == foreign.Id);
        loan.Status.Should().NotBe(LoanStatus.Draft);
    }

    [Fact]
    public async Task SaveDraft_NonInternalRole_ForeignLoanId_CreatesNewDraftInstead_AndLeavesForeignDraftUntouched()
    {
        var (controller, db) = CreateController(currentUserId: 1, currentUserRole: "Sales");
        var foreign = SeedDraft(db, createdByUserId: 2, suffix: "10");

        var dto = CreateValidDto(null);
        dto.LoanId = foreign.Id;

        var result = await controller.SaveDraft(dto);
        var response = ExtractResponse(result);

        response.Success.Should().BeTrue();
        response.Data!.LoanId.Should().NotBe(foreign.Id,
            "a non-owner's autosave must never write into someone else's draft — it should start a new one instead");

        var untouched = await db.Loans.FirstAsync(l => l.Id == foreign.Id);
        untouched.CreatedByUserId.Should().Be(2);
        untouched.RequestedAmount.Should().Be(50000, "the foreign draft's own data must be unaffected by someone else's autosave");

        var newDraft = await db.Loans.FirstAsync(l => l.Id == response.Data!.LoanId);
        newDraft.CreatedByUserId.Should().Be(1);
    }

    [Theory]
    [InlineData("Admin")]
    [InlineData("Manager")]
    public async Task SaveDraft_InternalRole_CanUpdateForeignDraft(string role)
    {
        var (controller, db) = CreateController(currentUserId: 99, currentUserRole: role);
        var foreign = SeedDraft(db, createdByUserId: 1, suffix: "11");

        var dto = CreateValidDto(null);
        dto.LoanId = foreign.Id;
        dto.Amount = 75000;

        var result = await controller.SaveDraft(dto);
        var response = ExtractResponse(result);

        response.Success.Should().BeTrue();
        response.Data!.LoanId.Should().Be(foreign.Id);
        var updated = await db.Loans.FirstAsync(l => l.Id == foreign.Id);
        updated.RequestedAmount.Should().Be(75000);
    }
}
