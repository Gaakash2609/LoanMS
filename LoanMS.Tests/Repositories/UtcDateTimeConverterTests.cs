using FluentAssertions;
using LoanMS.Infrastructure.Data;
using Xunit;

namespace LoanMS.Tests.Repositories;

/// <summary>
/// Pins the global DateTime-to-UTC converter (AppDbContext.ConfigureConventions)
/// against the bug it was added to close for good: Npgsql refuses to write a
/// DateTime with Kind=Unspecified to a 'timestamp with time zone' column
/// ("only UTC is supported"). This has now been hit twice in production from
/// two different call sites (ReportsController's `new DateTime(y,m,1)`, fixed
/// earlier; ObligationsController assigning a request DTO's DateTime? straight
/// onto the entity, live 2026-08-24) — the InMemory provider these tests
/// otherwise run on doesn't enforce Npgsql's Kind rule at all, so these test
/// the converter's actual conversion logic directly rather than a round-trip
/// that wouldn't catch a regression.
/// </summary>
public class UtcDateTimeConverterTests
{
    [Fact]
    public void Unspecified_IsTaggedUtc_WithoutShiftingTheClockValue()
    {
        var v = new DateTime(2026, 8, 24, 10, 30, 0, DateTimeKind.Unspecified);

        var stored = new UtcDateTimeConverter().ConvertToProvider(v) as DateTime?;

        stored.Should().NotBeNull();
        stored!.Value.Kind.Should().Be(DateTimeKind.Utc);
        // SpecifyKind, not ToUniversalTime: the wall-clock value must be
        // untouched, only the Kind tag changes.
        stored.Value.Should().Be(new DateTime(2026, 8, 24, 10, 30, 0, DateTimeKind.Utc));
    }

    [Fact]
    public void AlreadyUtc_PassesThroughUnchanged()
    {
        var v = new DateTime(2026, 8, 24, 10, 30, 0, DateTimeKind.Utc);

        var stored = new UtcDateTimeConverter().ConvertToProvider(v) as DateTime?;

        stored.Should().Be(v);
    }

    [Fact]
    public void Local_IsConvertedToTheEquivalentUtcInstant()
    {
        var v = new DateTime(2026, 8, 24, 10, 30, 0, DateTimeKind.Local);

        var stored = new UtcDateTimeConverter().ConvertToProvider(v) as DateTime?;

        stored!.Value.Kind.Should().Be(DateTimeKind.Utc);
        stored.Value.Should().Be(v.ToUniversalTime());
    }

    [Fact]
    public void Nullable_NullPassesThrough_NonNullFollowsTheSameRule()
    {
        var conv = new NullableUtcDateTimeConverter();

        (conv.ConvertToProvider(null) as DateTime?).Should().BeNull();

        var v = new DateTime(2026, 8, 24, 10, 30, 0, DateTimeKind.Unspecified);
        var stored = conv.ConvertToProvider(v) as DateTime?;
        stored!.Value.Kind.Should().Be(DateTimeKind.Utc);
        stored.Value.Should().Be(new DateTime(2026, 8, 24, 10, 30, 0, DateTimeKind.Utc));
    }
}
