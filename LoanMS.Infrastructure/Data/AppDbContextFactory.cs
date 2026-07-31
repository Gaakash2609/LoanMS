using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace LoanMS.Infrastructure.Data;

/// <summary>
/// Design-time factory used only by EF Core CLI tooling (dotnet ef migrations add,
/// dotnet ef migrations bundle, dotnet ef database update). EF Core discovers this
/// automatically and uses it instead of booting the full LoanMS.API host — so
/// unrelated startup concerns in Program.cs (JWT key validation, auth setup, etc.)
/// never run for a design-time build.
///
/// This factory always targets PostgreSQL/Npgsql. The committed migration history
/// contains Npgsql-specific annotations (Npgsql:ValueGenerationStrategy), so that is
/// the correct provider for any design-time operation regardless of what
/// Database:Provider a given runtime environment happens to select.
///
/// No secret is hardcoded here. The connection string is read from the same
/// environment-variable names Program.cs already uses at runtime
/// (ConnectionStrings__PostgreSQL, falling back to ConnectionStrings__DefaultConnection),
/// so existing deployment/CI conventions keep working unchanged.
/// </summary>
public class AppDbContextFactory : IDesignTimeDbContextFactory<AppDbContext>
{
    public AppDbContext CreateDbContext(string[] args)
    {
        var connectionString =
            Environment.GetEnvironmentVariable("ConnectionStrings__PostgreSQL")
            ?? Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection");

        if (string.IsNullOrWhiteSpace(connectionString))
        {
            throw new InvalidOperationException(
                "No PostgreSQL connection string found for design-time DbContext creation. " +
                "Set the ConnectionStrings__PostgreSQL environment variable " +
                "(or ConnectionStrings__DefaultConnection as a fallback) before running " +
                "any 'dotnet ef' command. This value is only used to build the migration " +
                "SQL/bundle at design time — it does not need to be a live connection " +
                "target when only generating a migrations bundle.");
        }

        var optionsBuilder = new DbContextOptionsBuilder<AppDbContext>();
        optionsBuilder.UseNpgsql(connectionString);

        return new AppDbContext(optionsBuilder.Options);
    }
}
