using LoanMS.Domain.Entities;
using LoanMS.Infrastructure.Data;

namespace LoanMS.API.Controllers;

/// <summary>
/// Phase 5C — tiny shared helper so TasksController and TicketsController
/// don't each hand-roll the same AssignmentLog insert. Deliberately just a
/// static helper (not a DI service) to match this codebase's existing
/// convention of controllers talking to AppDbContext directly for
/// non-core-domain writes (see LocationsController, DsaController, etc.) —
/// no new abstraction layer introduced.
///
/// Does NOT call SaveChangesAsync — callers add this to the same
/// AppDbContext instance they're already using and let their existing
/// SaveChangesAsync() call persist it atomically together with the
/// task/ticket write it accompanies.
/// </summary>
internal static class AssignmentLogHelper
{
    public static void Log(
        AppDbContext db,
        string entityType,
        int entityId,
        int? fromUserId,
        string? fromUserName,
        int toUserId,
        string toUserName,
        int assignedByUserId,
        string? assignedByName,
        string? notes = null)
    {
        db.AssignmentLogs.Add(new AssignmentLog
        {
            EntityType = entityType,
            EntityId = entityId,
            FromUserId = fromUserId,
            FromUserName = fromUserName,
            ToUserId = toUserId,
            ToUserName = toUserName,
            AssignedByUserId = assignedByUserId,
            AssignedByName = assignedByName,
            Notes = notes,
            CreatedAt = DateTime.UtcNow
        });
    }
}
