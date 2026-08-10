using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// NOTE ON VERIFICATION: same caveat as the other test files in this project
/// — could not be executed in the sandbox that produced it (no .NET SDK
/// available; network allowlist excludes the Microsoft/NuGet feeds needed).
/// Not compiler- or run-verified. Run `dotnet test` locally before relying
/// on these.
///
/// Phase 5 — Product / Lender Access Control: the data model has NO
/// relationship tying a User/Role to a specific Bank/Lender (BankMaster is
/// explicitly documented as "not currently referenced by Loan/Customer/
/// Payout via foreign key" and CreatedByUserId is explicitly "not used for
/// ownership checks") or to a specific Product (ProductOfferMatrix is a
/// global, product-keyed JSON blob with no user/role link at all; the
/// ProductTeam role — confirmed in Phase 3 — has no field tying it to a
/// product/LoanType either). Per the task instructions, nothing was invented
/// (no new FK, no migration, no free-text-based authorization), so no
/// production code changed in this phase. These tests are a regression
/// guard: they lock in the current, safe, unrestricted-but-authenticated
/// behavior so a future change can't silently introduce partial/unsafe
/// filtering without a test failing first.
/// </summary>
public class ProductLenderAccessControlTests
{
    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    private static ControllerContext ContextFor(string role, int userId = 1) => new()
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim("userId", userId.ToString()),
                new Claim("role", role)
            }, "TestAuth"))
        }
    };

    // ── Banks (Lender) ───────────────────────────────────────────────────────

    [Fact]
    public async Task Banks_Admin_SeesAllBanks()
    {
        var db = CreateContext();
        db.Banks.AddRange(
            new BankMaster { Id = 1, BankName = "Bank A", CreatedByUserId = 5 },
            new BankMaster { Id = 2, BankName = "Bank B", CreatedByUserId = 6 });
        await db.SaveChangesAsync();

        var controller = new BanksController(db) { ControllerContext = ContextFor("Admin") };
        var result = (OkObjectResult)await controller.GetAll();
        var response = (ApiResponseDto<object>)result.Value!;
        var ids = ((IEnumerable<object>)response.Data!)
            .Select(b => (int)b.GetType().GetProperty("Id")!.GetValue(b)!).ToList();

        ids.Should().BeEquivalentTo(new[] { 1, 2 });
    }

    [Fact]
    public async Task Banks_NonAdminRole_StillSeesAllBanks_NoUnsafePartialFiltering()
    {
        // No authorization relationship exists to safely scope by — a
        // half-implemented filter (e.g. by CreatedByUserId, which the
        // controller explicitly documents as NOT an ownership field) would
        // be worse than no filter at all, since it would look like real
        // access control while actually being arbitrary. This test locks in
        // that Sales (and by the same reasoning, any other role) still gets
        // the same full list as Admin — unchanged from before this phase.
        var db = CreateContext();
        db.Banks.AddRange(
            new BankMaster { Id = 1, BankName = "Bank A", CreatedByUserId = 5 },
            new BankMaster { Id = 2, BankName = "Bank B", CreatedByUserId = 6 });
        await db.SaveChangesAsync();

        var controller = new BanksController(db) { ControllerContext = ContextFor("Sales", userId: 5) };
        var result = (OkObjectResult)await controller.GetAll();
        var response = (ApiResponseDto<object>)result.Value!;
        var ids = ((IEnumerable<object>)response.Data!)
            .Select(b => (int)b.GetType().GetProperty("Id")!.GetValue(b)!).ToList();

        // A userId=5 caller (matches Bank A's CreatedByUserId) still sees
        // Bank B too — proving CreatedByUserId is NOT being used as a scope.
        ids.Should().BeEquivalentTo(new[] { 1, 2 });
    }

    // ── Product Offer Matrix ─────────────────────────────────────────────────

    [Fact]
    public async Task ProductOfferMatrix_Admin_SeesAllProducts()
    {
        var db = CreateContext();
        db.ProductOfferMatrices.AddRange(
            new ProductOfferMatrix { Id = 1, ProductKey = "business_loan", MatrixJson = "{}" },
            new ProductOfferMatrix { Id = 2, ProductKey = "home_loan", MatrixJson = "{}" });
        await db.SaveChangesAsync();

        var controller = new ProductOfferMatrixController(db) { ControllerContext = ContextFor("Admin") };
        var result = (OkObjectResult)await controller.GetAll();
        var response = (ApiResponseDto<object>)result.Value!;
        var keys = ((IEnumerable<object>)response.Data!)
            .Select(p => (string)p.GetType().GetProperty("ProductKey")!.GetValue(p)!).ToList();

        keys.Should().BeEquivalentTo(new[] { "business_loan", "home_loan" });
    }

    [Fact]
    public async Task ProductOfferMatrix_ProductTeamRole_StillSeesAllProducts_NoUnsafePartialFiltering()
    {
        // ProductTeam (Phase 3) has no data-model field linking it to a
        // specific product/LoanType, so it cannot be safely scoped — this
        // locks in that it still gets the full list, same as every other
        // authenticated role, unchanged from before this phase.
        var db = CreateContext();
        db.ProductOfferMatrices.AddRange(
            new ProductOfferMatrix { Id = 1, ProductKey = "business_loan", MatrixJson = "{}" },
            new ProductOfferMatrix { Id = 2, ProductKey = "home_loan", MatrixJson = "{}" });
        await db.SaveChangesAsync();

        var controller = new ProductOfferMatrixController(db) { ControllerContext = ContextFor("ProductTeam") };
        var result = (OkObjectResult)await controller.GetAll();
        var response = (ApiResponseDto<object>)result.Value!;
        var keys = ((IEnumerable<object>)response.Data!)
            .Select(p => (string)p.GetType().GetProperty("ProductKey")!.GetValue(p)!).ToList();

        keys.Should().BeEquivalentTo(new[] { "business_loan", "home_loan" });
    }
}
