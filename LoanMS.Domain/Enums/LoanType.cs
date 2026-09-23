namespace LoanMS.Domain.Enums;

public enum LoanType
{
    Personal = 0,
    Business = 1,
    Home = 2,
    Vehicle = 3,
    Education = 4,
    Car = 5,
    LAP = 6,
    // Business overdraft / cash-credit facility. Persisted as the string
    // "Overdraft" (Loan.LoanType uses HasConversion<string>()), so adding this
    // value needs NO database migration and does not disturb existing rows —
    // they keep their own stored strings. Legacy's product key for it is
    // "over_draft" (mapped in WizardController._loanTypeMap).
    Overdraft = 7,
    // Insurance policy application. Legacy (efin-app.js LOAN_EMP_WORKFLOW.
    // insurance) modelled this as its own product with the approve_ins/
    // disburse_ins timeline actions ("Verify Insurance"/"Approve Policy"/
    // "Issue Policy"). It was previously folded into Personal by
    // WizardController._loanTypeMap, which erased the product identity on the
    // loan-detail/Timeline; kept as its own value so the Timeline shows the
    // insurance-labelled actions. String-persisted like the others → NO
    // migration, existing rows untouched. Every LoanType switch has a default
    // arm (DeviationEvaluator.Label _ =>, FOIR/tenure ternaries fall through),
    // so no exhaustive match breaks on this new value.
    Insurance = 8
}
