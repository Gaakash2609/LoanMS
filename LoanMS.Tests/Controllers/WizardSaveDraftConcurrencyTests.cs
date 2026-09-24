using System.Security.Claims;
using FluentAssertions;
using LoanMS.API.Controllers;
using LoanMS.Application.DTOs;
using LoanMS.Domain.Entities;
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
/// Regression tests for the SaveDraft same-PAN customer-creation robustness.
///
/// The reported symptom was a 500 (UNIQUE constraint failed: Customers.PanNumber)
/// whenever FindOrCreateCustomerAsync missed an existing customer during its
/// lookup yet the subsequent INSERT still collided with the unfiltered unique
/// index on PanNumber / Email. Two ways that happens:
///   (a) a SOFT-DELETED customer already holds that PAN/email — the (previously
///       IsDeleted-filtered) lookup missed it, the INSERT collided → 500;
///   (b) two truly-concurrent NEW drafts for the same person race between
///       lookup and INSERT (PostgreSQL row-level unique violation).
///
/// (a) is fixed by looking the unique-indexed PAN/Email up with
/// IgnoreQueryFilters and reactivating — deterministically tested here.
/// (b) is additionally covered by SaveDraft's retry-once on that specific
/// unique-constraint violation (see WizardController.IsCustomerUniqueViolation);
/// it cannot be reproduced deterministically here because the EF InMemory
/// provider does not enforce unique constraints and SQLite's DB-level locking
/// raises "database is locked" rather than PostgreSQL's clean row-level
/// violation — so it is covered by code + build, with (a) guarding the
/// user-observable outcome (no duplicate customer, no 500).
/// </summary>
public class WizardSaveDraftConcurrencyTests
{
    private static (WizardController controller, AppDbContext db) CreateController()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        var db = new AppDbContext(options);

        var claims = new ClaimsIdentity(new[]
        {
            new Claim("userId", "1"),
            new Claim("role", "Sales")
        }, "TestAuth");

        var controller = new WizardController(db, NullLogger<WizardController>.Instance,
            RolePermissionTestDouble.AllowAll(), new LoanMS.API.Services.LoginUserAssignmentService(db))
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(claims) }
            }
        };
        return (controller, db);
    }

    private static WizardSubmitDto DraftDto(string pan, string email) => new()
    {
        FullName = "Race Applicant",
        Mobile   = "9876500000",
        Email    = email,
        Pan      = pan,
        Amount   = 100000,
        LoanType = "personal_loan",
        LoanRate = 12,
        Tenure   = 24,
    };

    [Fact]
    public async Task SaveDraft_NewDraft_WithSoftDeletedPan_ReusesAndReactivates_NoDuplicate_No500()
    {
        var (controller, db) = CreateController();

        // A soft-deleted customer already physically holds this PAN/email.
        // The unique index on those columns is NOT filtered by IsDeleted, so a
        // fresh INSERT would collide → the exact 500 this fix removes.
        const string pan = "RACEP1234X";
        const string email = "racep1234x@race.test";
        db.Customers.Add(new Customer
        {
            FullName = "Old Record", Email = email, PanNumber = pan,
            Phone = "9000000000", IsDeleted = true, CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();

        var result = await controller.SaveDraft(DraftDto(pan, email));

        // Not an unhandled 500.
        (result as ObjectResult)?.StatusCode.Should().NotBe(500);
        result.Should().BeOfType<OkObjectResult>();

        // Still exactly ONE customer for that PAN — reused, not duplicated — and
        // reactivated for the new application.
        var customers = await db.Customers.IgnoreQueryFilters()
            .Where(c => c.PanNumber == pan).ToListAsync();
        customers.Should().HaveCount(1);
        customers[0].IsDeleted.Should().BeFalse("a new application reactivates the soft-deleted customer");
    }

    [Fact]
    public async Task SaveDraft_TwoSequentialDrafts_SamePan_ShareOneCustomer_NoDuplicate()
    {
        var (controller, db) = CreateController();
        const string pan = "SEQAB1234Z";
        const string email = "seqab1234z@race.test";

        var r1 = await controller.SaveDraft(DraftDto(pan, email));
        var r2 = await controller.SaveDraft(DraftDto(pan, email));

        r1.Should().BeOfType<OkObjectResult>();
        r2.Should().BeOfType<OkObjectResult>();

        var customers = await db.Customers.IgnoreQueryFilters()
            .Where(c => c.PanNumber == pan).ToListAsync();
        customers.Should().HaveCount(1, "two drafts for the same PAN must share one customer");

        var loans = await db.Loans.CountAsync(l => l.CustomerId == customers[0].Id);
        loans.Should().Be(2, "each draft still creates its own loan against the shared customer");
    }
}
