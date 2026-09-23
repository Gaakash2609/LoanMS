// Canonical employment-type code mapping.
//
// The wizard's Employment Type select uses lowercase values
// ('salaried' | 'self_employed' | 'professional'), but the backend lender
// eligibility match (LenderConfigController) and the stored lender config
// (banksApi EMP_TYPES = ['SALARIED','SELFEMP','SENP']) speak the canonical
// UPPERCASE codes. The wizard already converts to these codes on submit; this
// is that same single mapping, extracted so the live eligibility PREVIEW sends
// the same canonical code (RA-7: the preview previously sent the raw
// 'self_employed', which the backend uppercased to 'SELF_EMPLOYED' and no
// lender config — keyed on 'SELFEMP' — ever matched, so self-employed/
// professional applicants were wrongly filtered out in the preview only).
export function toEmploymentCode(value: string | null | undefined): string {
  switch (value) {
    case 'salaried':      return 'SALARIED'
    case 'self_employed': return 'SELFEMP'
    case 'professional':  return 'PROFESSIONAL'
    default:              return value ?? ''
  }
}
