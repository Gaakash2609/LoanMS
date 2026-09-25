using System.Text;
using FluentAssertions;
using LoanMS.API.Middleware;
using LoanMS.Application.DTOs;
using LoanMS.Infrastructure.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Npgsql;
using Xunit;

namespace LoanMS.Tests.Middleware;

/// <summary>
/// The DB-level backstop: when two requests race past the application guard,
/// PostgreSQL's partial unique index rejects the loser (23505). That must reach
/// the user as a clean 409 with a business message — never a 500 and never the
/// raw "duplicate key value violates…" text.
/// </summary>
public class UniqueViolationConflictTests
{
    private static DbUpdateException PgUnique(string constraint) =>
        new("save failed", new PostgresException("duplicate key value violates unique constraint \"" + constraint + "\"",
            "ERROR", "ERROR", "23505", constraintName: constraint));

    [Fact]
    public void Classify_ActiveApplicationIndex_IsActiveApplicationConflict()
    {
        var r = DbConflicts.Classify(PgUnique(AppDbContext.ActiveApplicationIndex));
        r.Should().NotBeNull();
        r!.Value.Code.Should().Be(ApiErrorCodes.ActiveApplicationExists);
    }

    [Theory]
    [InlineData("UX_Customers_PanNormalized")]
    [InlineData("IX_Customers_PanNumber")]
    [InlineData("IX_Customers_Email")]
    public void Classify_CustomerIdentityIndexes_AreCustomerConflicts(string constraint) =>
        DbConflicts.Classify(PgUnique(constraint))!.Value.Code.Should().Be(ApiErrorCodes.CustomerExists);

    [Fact]
    public void Classify_UnrelatedUniqueIndex_IsNotSwallowed() =>
        DbConflicts.Classify(PgUnique("IX_Loans_LoanNumber")).Should().BeNull();

    [Fact]
    public void Classify_SqliteDevMessages_AreRecognised()
    {
        DbConflicts.Classify(new DbUpdateException("x", new Exception("SQLite Error 19: 'UNIQUE constraint failed: Loans.CustomerId'.")))!
            .Value.Code.Should().Be(ApiErrorCodes.ActiveApplicationExists);
    }

    [Fact]
    public async Task Middleware_MapsTheLostRaceTo409_WithoutLeakingTheDatabaseError()
    {
        var env = new Mock<IWebHostEnvironment>();
        env.Setup(e => e.EnvironmentName).Returns(Environments.Production);
        var mw = new ExceptionMiddleware(_ => throw PgUnique(AppDbContext.ActiveApplicationIndex),
            NullLogger<ExceptionMiddleware>.Instance, env.Object);
        var ctx = new DefaultHttpContext();
        ctx.Response.Body = new MemoryStream();

        await mw.InvokeAsync(ctx);

        ctx.Response.StatusCode.Should().Be(StatusCodes.Status409Conflict);
        ctx.Response.Body.Position = 0;
        var body = Encoding.UTF8.GetString(((MemoryStream)ctx.Response.Body).ToArray());
        body.Should().Contain("Active application exists").And.Contain(ApiErrorCodes.ActiveApplicationExists);
        body.Should().NotContain("duplicate key").And.NotContain("23505");
    }
}
