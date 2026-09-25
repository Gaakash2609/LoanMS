using LoanMS.Application.DTOs;

namespace LoanMS.Infrastructure.Data;

/// <summary>
/// Recognises the unique-constraint violations that back the duplicate-customer
/// and one-active-application rules, so a lost race surfaces as a clean 409
/// with a business message — never a raw database error or a 500.
/// PostgreSQL: SqlState 23505 + constraint name. SQLite (dev): "UNIQUE constraint failed: Table.Column".
/// </summary>
public static class DbConflicts
{
    public const string ActiveApplicationRaceMessage =
        "Active application exists: another application for this customer was created at the same moment. " +
        "Refresh and check the customer's applications.";
    public const string CustomerRaceMessage =
        "A customer with the same PAN or email was saved at the same moment. Please try again.";

    public static (string Code, string Message)? Classify(Exception ex)
    {
        for (Exception? e = ex; e != null; e = e.InnerException)
        {
            if (e is Npgsql.PostgresException pg && pg.SqlState == "23505")
            {
                var name = pg.ConstraintName ?? string.Empty;
                if (name == AppDbContext.ActiveApplicationIndex)
                    return (ApiErrorCodes.ActiveApplicationExists, ActiveApplicationRaceMessage);
                if (name.StartsWith("IX_Customers_", StringComparison.Ordinal) || name == AppDbContext.CustomerPanIndex)
                    return (ApiErrorCodes.CustomerExists, CustomerRaceMessage);
                return null;
            }
            var m = e.Message ?? string.Empty;
            if (m.Contains("UNIQUE constraint failed: Loans.CustomerId", StringComparison.Ordinal))
                return (ApiErrorCodes.ActiveApplicationExists, ActiveApplicationRaceMessage);
            if (m.Contains("UNIQUE constraint failed: Customers.", StringComparison.Ordinal))
                return (ApiErrorCodes.CustomerExists, CustomerRaceMessage);
        }
        return null;
    }
}
