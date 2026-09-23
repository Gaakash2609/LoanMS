import { describe, it, expect } from 'vitest'
import { mapDocNameToBackendType, validateDocFile, MANDATORY_DOC_TYPES, isBankStatementDocName } from '@/pages/NewApplicationPage'

// LoansController.UploadDocument's fixed allowlist (LoanMS.API/Controllers/
// LoansController.cs) — the ONLY values the backend accepts as documentType.
// Anything else is rejected with 400 "Invalid document type." This whitelist
// is mirrored (not imported) because it lives in the backend; keeping this
// list here makes drift between frontend and backend visible as a failing
// test instead of a silent 400 at upload time.
const BACKEND_DOC_TYPE_WHITELIST = [
  'identity', 'address', 'income', 'bank_statement',
  'salary_slip', 'itr', 'gst', 'property', 'other',
]

describe('mapDocNameToBackendType — Step 8 documentType whitelist fix', () => {
  // 7B-1: previously every non-mandatory Step-8 document was uploaded with
  // its raw display name (e.g. "Business Registration / Udyam / GST
  // Certificate") as the documentType, and self-employed applicants'
  // mandatory "Business Vintage Proof" was hard-mapped to the invalid
  // 'business_proof' — the backend whitelist has neither, so uploads were
  // always rejected with 400. Every mapped value must land in the whitelist.
  const sampleDocNames = [
    'PAN Card (Self-attested copy)',
    'Aadhaar Card – Front & Back (Self-attested copy)',
    'Passport-size Photograph (2 copies)',
    'Last 3 Month Salary Slips',
    'Last 6 Month Bank Statement',
    'Business Vintage Proof',
    'Last 3 Years ITR with Computation Sheet',
    'Latest Form 16 / ITR (Last 2 years)',
    'GST Returns (Last 6 months)',
    'Business Registration / Udyam / GST Certificate',
    'Property Title Deed / Chain of Documents',
    'Sale Agreement / Allotment Letter',
    'Encumbrance Certificate (EC)',
    'RC Book of Vehicle',
    'Driving Licence',
    'Academic Marksheets (Last 2 completed years)',
    'Medical Examination Report (if Sum Assured > ₹50 Lakh)',
    'Office / Employee ID Card (Optional)',
    'Appointment Letter / Employment Proof (Optional)',
    'MOA / AOA / Partnership Deed (as applicable)',
    'Office Address Proof',
  ]

  it.each(sampleDocNames)('maps %s to a backend-whitelisted documentType', name => {
    expect(BACKEND_DOC_TYPE_WHITELIST).toContain(mapDocNameToBackendType(name))
  })

  it('maps income-proxy documents (incl. Business Vintage Proof) to "income"', () => {
    expect(mapDocNameToBackendType('Business Vintage Proof')).toBe('income')
  })

  it('maps KYC identity documents to "identity"', () => {
    expect(mapDocNameToBackendType('PAN Card (Self-attested copy)')).toBe('identity')
    expect(mapDocNameToBackendType('Aadhaar Card – Front & Back (Self-attested copy)')).toBe('identity')
  })

  it('maps salary slips and bank statements to their exact mandatory types', () => {
    expect(mapDocNameToBackendType('Last 3 Month Salary Slips')).toBe('salary_slip')
    expect(mapDocNameToBackendType('Last 6 Month Bank Statement')).toBe('bank_statement')
  })

  it('maps ITR/Form 16 documents to "itr" and GST documents to "gst"', () => {
    expect(mapDocNameToBackendType('Last 3 Years ITR with Computation Sheet')).toBe('itr')
    expect(mapDocNameToBackendType('GST Returns (Last 6 months)')).toBe('gst')
  })

  it('maps property documents to "property"', () => {
    expect(mapDocNameToBackendType('Property Title Deed / Chain of Documents')).toBe('property')
  })

  it('falls back to "other" for a name matching no known category', () => {
    expect(mapDocNameToBackendType('Vehicle Valuation / Inspection Report')).toBe('other')
  })
})

describe('MANDATORY_DOC_TYPES — must stay inside the backend allowlist', () => {
  it('every mandatory doc key maps to a whitelisted documentType', () => {
    for (const [key, type] of Object.entries(MANDATORY_DOC_TYPES)) {
      expect(BACKEND_DOC_TYPE_WHITELIST, `MANDATORY_DOC_TYPES.${key}`).toContain(type)
    }
  })

  it('bizVintageProof (self-employed mandatory doc) no longer uses the invalid "business_proof" type', () => {
    expect(MANDATORY_DOC_TYPES.bizVintageProof).not.toBe('business_proof')
  })
})

describe('isBankStatementDocName — Perfios routing gate (7B-2 fix)', () => {
  // 7B-2: Vanilla routes EVERY doc name containing "bank statement" or
  // "banking" through Perfios (efin-app.js:9536/9937/10080 — all three test
  // /bank statement|banking/i with no exception for whose statement it is or
  // its period). Previously Step8 only wired the Perfios modal for the single
  // hardcoded 'bankStatement6mo' key — a co-applicant's or a self-employed
  // current-account statement fell through to a plain file input with no
  // Perfios run at all. Every one of these must route to BankStatementDoc.
  const bankStatementNames = [
    'Last 6 Month Bank Statement',
    'Co-applicant Last 6 Month Bank Statement',
    'Last 6 Month Current Account Bank Statement',
    'Last 12 Month Current Account Bank Statement',
    'Last 12 Month Bank Statement',
    'Current Account Banking Statement',
  ]

  it.each(bankStatementNames)('routes %s through the Perfios flow', name => {
    expect(isBankStatementDocName(name)).toBe(true)
  })

  const nonBankStatementNames = [
    'PAN Card (Self-attested copy)',
    'Last 3 Month Salary Slips',
    'Business Vintage Proof',
    'GST Returns (Last 6 months)',
    'Property Title Deed / Chain of Documents',
  ]

  it.each(nonBankStatementNames)('does not route %s through the Perfios flow', name => {
    expect(isBankStatementDocName(name)).toBe(false)
  })
})

describe('validateDocFile — client-side mirror of backend file restrictions', () => {
  function file(name: string, sizeBytes: number): File {
    return new File([new Uint8Array(sizeBytes)], name)
  }

  it('accepts an allowed extension within the size limit', () => {
    expect(validateDocFile(file('statement.pdf', 1024))).toBeNull()
    expect(validateDocFile(file('photo.jpg', 1024))).toBeNull()
    expect(validateDocFile(file('sheet.xlsx', 1024))).toBeNull()
  })

  it('rejects a disallowed extension', () => {
    expect(validateDocFile(file('malware.exe', 1024))).toMatch(/not allowed/i)
    expect(validateDocFile(file('archive.zip', 1024))).toMatch(/not allowed/i)
  })

  it('rejects a file larger than 20 MB (matches backend RequestSizeLimit)', () => {
    const tooBig = 20 * 1024 * 1024 + 1
    expect(validateDocFile(file('big.pdf', tooBig))).toMatch(/20 MB/i)
  })

  it('accepts a file exactly at the 20 MB boundary', () => {
    expect(validateDocFile(file('boundary.pdf', 20 * 1024 * 1024))).toBeNull()
  })
})
