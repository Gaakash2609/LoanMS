using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Logging;

namespace LoanMS.Infrastructure.Data;

/// <summary>
/// Extension methods for AppDbContext — production optimizations.
/// Applied automatically when using PostgreSQL provider.
/// </summary>
public static class AppDbContextExtensions
{
    /// <summary>
    /// Apply PostgreSQL-specific index optimizations.
    /// Call once after initial migration on PostgreSQL.
    /// </summary>
    public static async Task ApplyPostgresOptimizationsAsync(
        this AppDbContext db,
        ILogger logger)
    {
        try
        {
            // Composite index for common loan queries
            await db.Database.ExecuteSqlRawAsync(@"
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loans_status_created
                ON ""Loans""(""Status"", ""CreatedAt"" DESC)
                WHERE ""IsDeleted"" = false;
            ");

            await db.Database.ExecuteSqlRawAsync(@"
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loans_customer_id
                ON ""Loans""(""CustomerId"")
                WHERE ""IsDeleted"" = false;
            ");

            await db.Database.ExecuteSqlRawAsync(@"
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_created
                ON ""AuditLogs""(""CreatedAt"" DESC);
            ");

            await db.Database.ExecuteSqlRawAsync(@"
                CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customers_pan
                ON ""Customers""(""PanNumber"")
                WHERE ""PanNumber"" IS NOT NULL AND ""IsDeleted"" = false;
            ");

            logger.LogInformation("PostgreSQL optimizations applied successfully.");
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not apply PostgreSQL optimizations: {Message}", ex.Message);
        }
    }
}
