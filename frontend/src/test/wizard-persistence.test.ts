import { describe, it, expect } from 'vitest'
import { computeStepErrors } from '@/pages/NewApplicationPage'

// Minimal WizardData stand-in — Step-8 validation only reads `documents` and
// `uploadedDocKeys`, never data fields, so an empty object is sufficient.
type Data = Parameters<typeof computeStepErrors>[1]
const DATA = {} as unknown as Data

/**
 * Refresh-safety (live-data persistence): a MANDATORY document is satisfied by
 * either a File picked in this session OR a document already persisted to the
 * draft on the server (uploadedDocKeys). This is what lets a RESUMED draft —
 * where the File objects are gone but the server copies remain — pass Step-8
 * validation without asking the user to re-attach already-saved documents.
 */
describe('wizard Step-8 mandatory-document validation (persistence-aware)', () => {
  it('flags both mandatory docs when nothing is attached or saved', () => {
    const errs = computeStepErrors(8, DATA, {}, {})
    expect(errs.salarySlip3mo).toBeTruthy()
    expect(errs.bankStatement6mo).toBeTruthy()
  })

  it('passes when both docs are attached as pending Files this session', () => {
    const documents = {
      salarySlip3mo: new File(['x'], 'sal.pdf'),
      bankStatement6mo: new File(['x'], 'bank.pdf'),
    }
    const errs = computeStepErrors(8, DATA, documents, {})
    expect(errs.salarySlip3mo).toBeUndefined()
    expect(errs.bankStatement6mo).toBeUndefined()
  })

  it('passes when both docs are already SERVER-SAVED (resumed draft, no local File)', () => {
    // The refresh/resume case: documents state is empty (Files lost on reload)
    // but the server has them — validation must accept the persisted copies.
    const uploaded = { salarySlip3mo: { id: 1, name: 'sal.pdf' }, bankStatement6mo: { id: 2, name: 'bank.pdf' } }
    const errs = computeStepErrors(8, DATA, {}, uploaded)
    expect(errs.salarySlip3mo).toBeUndefined()
    expect(errs.bankStatement6mo).toBeUndefined()
  })

  it('mixes pending File + server-saved and still passes', () => {
    const documents = { salarySlip3mo: new File(['x'], 'sal.pdf') }
    const uploaded = { bankStatement6mo: { id: 2, name: 'bank.pdf' } }
    const errs = computeStepErrors(8, DATA, documents, uploaded)
    expect(errs.salarySlip3mo).toBeUndefined()
    expect(errs.bankStatement6mo).toBeUndefined()
  })

  it('still flags the one that is neither attached nor saved', () => {
    const uploaded = { salarySlip3mo: { id: 1, name: 'sal.pdf' } }
    const errs = computeStepErrors(8, DATA, {}, uploaded)
    expect(errs.salarySlip3mo).toBeUndefined()
    expect(errs.bankStatement6mo).toBeTruthy()
  })

  // Vanilla parity: a Self-Employed applicant's mandatory income doc is Business
  // Vintage Proof, NOT Salary Slips (DOC_MANDATORY_INCOME_SELFEMP).
  it('self-employed requires Business Vintage Proof (not Salary Slips)', () => {
    const SE = { empType: 'self_employed' } as unknown as Data
    const errs = computeStepErrors(8, SE, {}, {})
    expect(errs.bizVintageProof).toBeTruthy()
    expect(errs.bankStatement6mo).toBeTruthy()
    expect(errs.salarySlip3mo).toBeUndefined() // salary slips NOT required for self-employed
    // Attaching Business Vintage Proof + Bank Statement clears it.
    const ok = computeStepErrors(8, SE, { bizVintageProof: new File(['x'], 'biz.pdf'), bankStatement6mo: new File(['x'], 'bank.pdf') }, {})
    expect(Object.keys(ok).length).toBe(0)
  })

  // Vanilla parity: Education's doc list uses co-applicant income docs, so NONE
  // of _WIZ_MANDATORY_DOC_NAMES appear → no mandatory Step-8 doc (no dead-end).
  it('education has no mandatory Step-8 documents', () => {
    const EDU = { loanType: 'education', empType: 'salaried' } as unknown as Data
    const errs = computeStepErrors(8, EDU, {}, {})
    expect(Object.keys(errs).length).toBe(0)
  })
})
