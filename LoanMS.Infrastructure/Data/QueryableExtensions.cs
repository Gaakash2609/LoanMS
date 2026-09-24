using Microsoft.EntityFrameworkCore;

namespace LoanMS.Infrastructure.Data;

public static class QueryableExtensions
{
    /// <summary>
    /// Keeps soft-deleted users resolvable as the creator / changer / claimant /
    /// assignee of HISTORICAL records. Ignores only the named User soft-delete
    /// filter — every other entity's filter (Loan, Customer, Task, ...) still
    /// applies. Use on queries rooted in historical records (loans, status
    /// history, tasks, tickets, payout claims, reports); never on user lists,
    /// look-ups or authentication, which must keep hiding deleted users.
    /// </summary>
    public static IQueryable<T> IncludeDeletedUsers<T>(this IQueryable<T> query) where T : class =>
        query.IgnoreQueryFilters([AppDbContext.UserSoftDeleteFilter]);
}
