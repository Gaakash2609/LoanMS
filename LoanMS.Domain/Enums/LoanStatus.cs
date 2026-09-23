namespace LoanMS.Domain.Enums;

public enum LoanStatus
{
    Draft = 0,
    Submitted = 1,
    UnderReview = 2,
    Approved = 3,
    Rejected = 4,
    Disbursed = 5,
    Closed = 6,
    // Paused mid-pipeline. Persisted as the string "OnHold" (Loan.Status uses
    // HasConversion<string>()) so adding it needs NO migration and leaves
    // existing rows untouched. Not part of the linear Draft→…→Closed machine:
    // it's entered from an active state via the dedicated Hold action and
    // exited via Un-hold, which restores whatever status the loan held before
    // (read back from LoanStatusHistory). Legacy modelled this as its
    // string status "hold" (efin-app.js holdApp/unholdApp).
    OnHold = 7,
    // A policy deviation has been raised on an in-review loan and is awaiting
    // a decision (approve → loan proceeds, reject → declined). String-
    // persisted, so no migration. Legacy's "decision" stage
    // (efin-app.js confirmDeviation). Not part of the linear machine and not
    // in GetAllowedTransitions — it is entered/left only through the
    // dedicated deviation actions, exactly like OnHold.
    Decision = 8,
    // Between Approved and Disbursed: the customer has been sent the deal
    // confirmation (sanction terms) and is awaiting/has given their reply,
    // and NACH + Customer Agreement are being finalised before disbursement.
    // String-persisted (HasConversion<string>()) so adding it needs NO
    // migration and leaves existing rows untouched — same pattern as OnHold/
    // Decision above. Legacy's "acceptance" status (efin-app.js
    // _dcFinaliseAcceptance sets app.status='acceptance' when the deal
    // confirmation email is sent, gated on the FI report being complete and
    // Positive). IS part of the linear machine here (Approved → Acceptance →
    // Disbursed) but Approved → Disbursed directly remains allowed too, for
    // loans that don't go through a recorded deal-confirmation step.
    Acceptance = 9
}
