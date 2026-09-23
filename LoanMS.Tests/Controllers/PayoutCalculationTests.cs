using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
using LoanMS.Domain.Enums;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanMS.Tests.Controllers;

/// <summary>
/// F-2 regression: the suggested payout is a percentage of the APPROVED
/// (disbursed) amount — the money actually lent — not the requested amount.
/// This matches the PayoutRule contract ("% of approved/disbursed amount") and
/// legacy autoCreatePayoutClaim. Previously the controller used RequestedAmount,
/// over/understating the payout whenever a loan was approved for a different
/// figure than requested. The calculation had no test coverage before this.
/// </summary>
public class PayoutCalculationTests
{
    private static AppDbContext Seed(decimal requested, decimal? approved, decimal pct,
        decimal? min = null, decimal? max = null, DateTime? disbursedAt = null)
    {
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

        var cust = new Customer { Id = 1, FullName = "Cust" };
        var loan = new Loan
        {
            Id = 1, LoanNumber = "EFIN-1", CustomerId = 1, Customer = cust,
            LoanType = LoanType.Personal, RequestedAmount = requested, ApprovedAmount = approved,
            DisbursedAt = disbursedAt,
        };
        db.Customers.Add(cust);
        db.Loans.Add(loan);
        db.Set<PayoutRule>().Add(new PayoutRule
        {
            Id = 1, LoanType = "personal_loan", Percentage = pct,
            MinPayout = min, MaxPayout = max, IsActive = true,
        });
        db.SaveChanges();
        return db;
    }

    private static PayoutController AdminController(AppDbContext db) => new(db)
    {
        ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                {
                    new Claim("userId", "1"),
                    new Claim(ClaimTypes.Role, "Admin"),
                }, "TestAuth")),
            },
        },
    };

    private static decimal SuggestedAmount(IActionResult result)
    {
        var ok = result.Should().BeOfType<OkObjectResult>().Subject;
        var body = ok.Value.Should().BeOfType<ApiResponseDto<object>>().Subject;
        body.Success.Should().BeTrue();
        var prop = body.Data!.GetType().GetProperty("suggestedAmount")!;
        return Convert.ToDecimal(prop.GetValue(body.Data));
    }

    [Fact]
    public async Task Suggest_uses_approved_amount_not_requested()
    {
        // requested 10,00,000 but approved for 8,00,000 → payout on 8,00,000
        using var db = Seed(requested: 1_000_000m, approved: 800_000m, pct: 1.5m);
        var result = await AdminController(db).Suggest(1);
        SuggestedAmount(result).Should().Be(12_000m);   // 800000 * 1.5% — NOT 15000
    }

    [Fact]
    public async Task Suggest_falls_back_to_requested_when_not_yet_approved()
    {
        using var db = Seed(requested: 500_000m, approved: null, pct: 2m);
        var result = await AdminController(db).Suggest(1);
        SuggestedAmount(result).Should().Be(10_000m);   // 500000 * 2%
    }

    [Fact]
    public async Task Suggest_clamps_to_the_rule_min_and_max_on_the_approved_base()
    {
        // 8,00,000 * 0.1% = 800, floored up to the 5,000 minimum
        using var dbMin = Seed(requested: 1_000_000m, approved: 800_000m, pct: 0.1m, min: 5_000m);
        SuggestedAmount(await AdminController(dbMin).Suggest(1)).Should().Be(5_000m);

        // 8,00,000 * 5% = 40,000, capped at the 25,000 maximum
        using var dbMax = Seed(requested: 1_000_000m, approved: 800_000m, pct: 5m, max: 25_000m);
        SuggestedAmount(await AdminController(dbMax).Suggest(1)).Should().Be(25_000m);
    }

    // RA-3 — a payout claim is a post-disbursement activity (legacy gated every
    // creation path on status 'disbursed'). Submit must refuse an undisbursed loan.
    [Fact]
    public async Task Submit_is_rejected_for_a_loan_that_has_not_been_disbursed()
    {
        using var db = Seed(requested: 1_000_000m, approved: 800_000m, pct: 1.5m); // DisbursedAt null
        var result = await AdminController(db).Submit(new ClaimCreateDto { LoanId = 1 });

        var bad = result.Should().BeOfType<BadRequestObjectResult>().Subject;
        var body = bad.Value.Should().BeOfType<ApiResponseDto<bool>>().Subject;
        body.Success.Should().BeFalse();
        string.Join(" ", body.Errors).Should().Contain("disbursed");
        db.PayoutClaims.Should().BeEmpty();   // nothing persisted
    }

    [Fact]
    public async Task Submit_succeeds_once_the_loan_is_disbursed_using_the_approved_base()
    {
        using var db = Seed(requested: 1_000_000m, approved: 800_000m, pct: 1.5m, disbursedAt: DateTime.UtcNow);
        var result = await AdminController(db).Submit(new ClaimCreateDto { LoanId = 1 });

        result.Should().BeOfType<OkObjectResult>();
        db.PayoutClaims.Should().ContainSingle();
        db.PayoutClaims.Single().ClaimAmount.Should().Be(12_000m);  // 800000 * 1.5%
    }
}
