namespace LoanMS.Application.Interfaces;

/// <summary>
/// The application-level transitions that LoanService still owns (Reject, Reopen,
/// Admin override, deal-confirmation → Acceptance) need to cascade into the offer
/// workflow records (offers / deviation requests / credit approvals / sanctions /
/// disbursements). LoanService only sees IUnitOfWork, so the offer workflow
/// service implements this and is injected. Cascade methods stage their changes
/// on the shared scoped DbContext and never save — the caller's SaveChanges makes
/// the status change and its cascade atomic.
/// </summary>
public interface IOfferWorkflowHooks
{
    Task<bool> HasActiveSanctionAsync(int loanId);
    Task<bool> HasCompletedDisbursementAsync(int loanId);
    /// <summary>Close open deviation requests, invalidate current credit approvals,
    /// cancel the active sanction (system, reason = rejection). Offers are frozen, not changed.</summary>
    Task OnApplicationRejectedAsync(int loanId, int userId, string? reason);
    /// <summary>After a reopen that resumes at Offer: reset approval status and
    /// recompute each active offer's deviation status from its stored evaluation.</summary>
    Task OnApplicationReopenedAsync(int loanId, int userId);
    /// <summary>Hold: pause the application's open tasks (they cannot be completed while paused).</summary>
    Task OnApplicationHeldAsync(int loanId, string? reason);
    /// <summary>Un-hold: resume the paused tasks.</summary>
    Task OnApplicationUnheldAsync(int loanId);
}
