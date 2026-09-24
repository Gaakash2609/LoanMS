using FluentAssertions;
using LoanMS.Infrastructure.Data;
using LoanMS.Infrastructure.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace LoanMS.Tests.Services;

public class EmailConfigStoreTests
{
    [Fact]
    public async Task Save_AfterClear_ReactivatesTheSameRow_InsteadOfInsertingADuplicate()
    {
        // Regression: Clear soft-deletes the single org-wide row, which still
        // owns the unique Key index; the next Save looked it up through the
        // soft-delete filter, missed it, inserted a second row and failed with
        // a duplicate-key 500 on PostgreSQL.
        using var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);
        var store = new EmailConfigStore(db, new EphemeralDataProtectionProvider());

        await store.SaveAsync(new EmailConfigRecord { FromEmail = "first@x.com" });
        await store.ClearAsync();
        await store.SaveAsync(new EmailConfigRecord { FromEmail = "second@x.com" });

        db.AppSettings.IgnoreQueryFilters().Count(s => s.Key == EmailConfigStore.Key).Should().Be(1);
        (await store.GetAsync())!.FromEmail.Should().Be("second@x.com");
    }
}
