using FluentAssertions;
using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanMS.Tests.Repositories;

/// <summary>
/// Guards the LoanReference ↔ Loan relationship against re-acquiring a shadow
/// foreign key.
///
/// AppDbContext configured this with a parameterless `WithMany()`, so EF treated
/// it as a relationship to an unnamed navigation and then discovered
/// Loan.References separately by convention — two relationships between the same
/// pair of types. The second needed its own FK, and since LoanId was taken it got
/// the shadow property "LoanId1".
///
/// No migration ever created a LoanReferences.LoanId1 column, so on PostgreSQL
/// every loan-detail request failed outright: LoanRepository.GetByIdAsync does
/// `.Include(l => l.References)`, EF emitted `l5."LoanId1"`, and PostgreSQL
/// answered `42703: column l5.LoanId1 does not exist` → HTTP 500 from
/// GET /api/loans/{id}.
///
/// It was invisible in the SQLite dev path because that database is built with
/// EnsureCreated() straight from the model, so the phantom column existed there.
/// These tests assert against the EF model itself, so they catch it on any
/// provider.
/// </summary>
public class LoanReferenceMappingTests
{
    private static AppDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options;
        return new AppDbContext(options);
    }

    [Fact]
    public void LoanReference_HasNoShadowForeignKeyProperties()
    {
        using var db = CreateContext();
        var entity = db.Model.FindEntityType(typeof(LoanReference))!;

        var shadow = entity.GetProperties()
            .Where(p => p.IsShadowProperty())
            .Select(p => p.Name)
            .ToList();

        shadow.Should().BeEmpty(
            "a shadow FK here means a duplicate Loan relationship, which emits a column no migration creates");
    }

    [Fact]
    public void LoanReference_HasExactlyOneRelationshipToLoan_KeyedOnLoanId()
    {
        using var db = CreateContext();
        var entity = db.Model.FindEntityType(typeof(LoanReference))!;

        var toLoan = entity.GetForeignKeys()
            .Where(fk => fk.PrincipalEntityType.ClrType == typeof(Loan))
            .ToList();

        toLoan.Should().HaveCount(1, "two relationships would force EF to invent a second FK column");
        toLoan[0].Properties.Select(p => p.Name).Should().Equal("LoanId");
    }

    [Fact]
    public void LoanReferences_RelationshipIsWiredToTheLoanReferencesNavigation()
    {
        using var db = CreateContext();
        var entity = db.Model.FindEntityType(typeof(LoanReference))!;

        var fk = entity.GetForeignKeys()
            .Single(f => f.PrincipalEntityType.ClrType == typeof(Loan));

        // The inverse navigation must be Loan.References — that is what makes it
        // one relationship instead of two.
        fk.PrincipalToDependent?.Name.Should().Be(nameof(Loan.References));
        fk.DependentToPrincipal?.Name.Should().Be(nameof(LoanReference.Loan));
    }

    [Fact]
    public void LoanReferences_MapsToTheLoanIdColumnOnly()
    {
        using var db = CreateContext();
        var entity = db.Model.FindEntityType(typeof(LoanReference))!;

        var columns = entity.GetProperties().Select(p => p.Name).ToList();

        columns.Should().Contain("LoanId");
        columns.Should().NotContain("LoanId1", "LoanId1 has no column in any migration");
    }
}
