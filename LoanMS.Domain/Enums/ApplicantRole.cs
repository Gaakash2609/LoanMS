namespace LoanMS.Domain.Enums;

// ── Applicant Role ────────────────────────────────────────────────────────────
// §6 isolation. The backend currently models a loan with a SINGLE Customer
// (Loan.CustomerId); co-applicants live only in the wizard's client-side JSON
// (ProductDataJson) and bureau data — there is no first-class co-applicant
// entity. Rather than introduce one invasively in Phase 2 (which would touch
// existing document/Perfios flows), the "minimum schema relationship" the spec
// asks for is captured with this role plus an ApplicantKey string on the
// verification/slip records, so every verification records WHOSE income it is
// and an applicant's slip can never be silently matched against a co-applicant's
// evidence. Whether a full LoanApplicant/CoApplicant entity is warranted is the
// one structural decision flagged for the Phase 2 review gate.
public enum ApplicantRole
{
    Applicant,
    CoApplicant
}
