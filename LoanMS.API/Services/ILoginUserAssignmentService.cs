using LoanMS.Domain.Entities;

namespace LoanMS.API.Services;

/// <summary>
/// Phase 2 RBAC — G-05. The Login-User auto-assignment engine that the Phase 1
/// audit found MISSING (assignment was manual only). When a new application is
/// submitted, this picks the most suitable ACTIVE Login User for the
/// application's Location by current workload, records the decision on the loan
/// (<see cref="Loan.LoginUserId"/>), and writes an immutable
/// <see cref="AssignmentAuditLog"/> trail row (Method = "auto") — reusing the
/// existing audit table whose own doc-comment already anticipated this engine.
///
/// The method mutates the (already tracked) loan and ADDS the audit row to the
/// same AppDbContext the caller is using, but does NOT call SaveChangesAsync —
/// exactly like <see cref="AssignmentLogHelper"/>. The caller persists it
/// atomically inside its own transaction/SaveChanges. Deterministic and
/// side-effect-free beyond those two writes, so it is unit-testable against the
/// EF InMemory provider.
/// </summary>
public interface ILoginUserAssignmentService
{
    /// <summary>
    /// Auto-assign a Login User to <paramref name="loan"/>. Safe no-op (returns
    /// Assigned = false with a reason) when the loan already has a Login User,
    /// has no Location, or no eligible active Login User exists — never throws
    /// on those cases, so a submission is never blocked by assignment.
    /// </summary>
    Task<LoginAssignmentResult> AutoAssignLoginUserAsync(Loan loan);
}

/// <summary>Outcome of an auto-assignment attempt (for logging/telemetry/tests).</summary>
public sealed record LoginAssignmentResult(
    bool Assigned,
    int? AssignedUserId,
    string? AssignedUserName,
    bool TieBreak,
    string Reason);
