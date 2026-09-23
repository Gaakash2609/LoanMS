import { describe, it, expect } from 'vitest'
import { computeStepErrors } from '@/pages/NewApplicationPage'

// The Next button's gate: handleNext advances only when validateCurrentStep()
// (i.e. computeStepErrors for the current step) is empty. handleBack only calls
// setStep(s-1) and never touches `data`, so Back is a pure step-index change —
// no field value can be lost by construction. These tests pin the Next gate
// per step (valid → 0 errors → advances; invalid → errors → stays).
type Data = Parameters<typeof computeStepErrors>[1]

// A fully valid wizard dataset (salaried personal loan) covering steps 1–6.
const VALID = {
  mobile: '9876500011', pan: 'ABCDE1234F', location: 'E2E Branch', salesPerson: 'Default Sales', channel: 'direct',
  kycAadhar: '123412341234', kycFirstName: 'Wizard', firstName: 'Wizard', lastName: 'E2E', kycPin: '400001',
  gender: 'Male', dob: '1990-05-15', aadhar: '123412341234', email: 'wiz@t.local', phone: '9876500011',
  father: 'Father E2E', mother: 'Mother E2E',
  street1: '1 Test Rd', street2: '2nd Cross', city: 'Mumbai', state: 'Maharashtra', zip: '400001', homeType: 'owned', sameAddr: true,
  empType: 'salaried', salary: '95000', obligations: '5000', compName: 'ACME', compType: 'Private Limited',
  desig: 'Engineer', officeEmail: 'wiz@acme.com', officeAddr1: 'Tower A', officeAddr2: 'BKC', officePin: '400051',
  loanType: 'personal_loan', amount: '600000', loanRate: '13.5', tenure: '48', purpose: 'Personal use',
} as unknown as Data

const noDocs = {}

describe('wizard Next-gate (computeStepErrors) per step', () => {
  it('Step 1 (Contact): valid data → no errors (Next advances)', () => {
    expect(Object.keys(computeStepErrors(1, VALID, noDocs, {})).length).toBe(0)
  })
  it('Step 1: empty → blocks with mobile/pan/location/salesPerson errors', () => {
    const e = computeStepErrors(1, {} as unknown as Data, noDocs, {})
    expect(e.mobile).toBeTruthy(); expect(e.pan).toBeTruthy()
    expect(e.location).toBeTruthy(); expect(e.salesPerson).toBeTruthy()
  })
  it('Step 1: invalid PAN/mobile format → blocks', () => {
    const e = computeStepErrors(1, { ...VALID, pan: 'BAD', mobile: '123' } as unknown as Data, noDocs, {})
    expect(e.pan).toBeTruthy(); expect(e.mobile).toBeTruthy()
  })
  it('Step 1: PAN is length-10 only, NOT the strict format regex (Vanilla parity)', () => {
    // Vanilla validateStep(1) accepts any 10-char PAN (length check only).
    expect(computeStepErrors(1, { ...VALID, pan: '1234567890' } as unknown as Data, noDocs, {}).pan).toBeUndefined()
    expect(computeStepErrors(1, { ...VALID, pan: 'ABCDE1234' } as unknown as Data, noDocs, {}).pan).toBeTruthy() // 9 chars
  })

  it('Step 3 (Personal): valid → no errors; missing DOB/gender → blocks', () => {
    expect(Object.keys(computeStepErrors(3, VALID, noDocs, {})).length).toBe(0)
    const e = computeStepErrors(3, { ...VALID, dob: '', gender: '' } as unknown as Data, noDocs, {})
    expect(e.dob).toBeTruthy(); expect(e.gender).toBeTruthy()
  })
  it('Step 3: Vanilla-required Aadhaar/Email/Father/Mother block when blank', () => {
    const e = computeStepErrors(3, { ...VALID, aadhar: '', email: '', father: '', mother: '' } as unknown as Data, noDocs, {})
    expect(e.aadhar).toBeTruthy(); expect(e.email).toBeTruthy()
    expect(e.father).toBeTruthy(); expect(e.mother).toBeTruthy()
  })

  it('Step 4 (Address): valid → no errors; bad PIN → blocks', () => {
    expect(Object.keys(computeStepErrors(4, VALID, noDocs, {})).length).toBe(0)
    expect(computeStepErrors(4, { ...VALID, zip: '12' } as unknown as Data, noDocs, {}).zip).toBeTruthy()
  })
  it('Step 4: Street & Locality is required (Vanilla parity)', () => {
    expect(computeStepErrors(4, { ...VALID, street2: '' } as unknown as Data, noDocs, {}).street2).toBeTruthy()
  })
  it('Step 4: permanent address required when not "same as current" (non-OD)', () => {
    const e = computeStepErrors(4, { ...VALID, sameAddr: false } as unknown as Data, noDocs, {})
    expect(e.pStreet1).toBeTruthy(); expect(e.pStreet2).toBeTruthy(); expect(e.pCity).toBeTruthy()
    expect(e.pState).toBeTruthy(); expect(e.pZip).toBeTruthy(); expect(e.pHomeType).toBeTruthy()
  })
  it('Step 4: over_draft skips permanent address entirely', () => {
    const e = computeStepErrors(4, { ...VALID, sameAddr: false, loanType: 'over_draft' } as unknown as Data, noDocs, {})
    expect(e.pStreet1).toBeUndefined(); expect(e.pHomeType).toBeUndefined()
  })

  it('Step 5 (Employment): valid → no errors; salary OPTIONAL + officeEmail salaried-only (Vanilla parity)', () => {
    expect(Object.keys(computeStepErrors(5, VALID, noDocs, {})).length).toBe(0)
    // Vanilla validateStep(5) does NOT require salary — empty salary must not block.
    expect(computeStepErrors(5, { ...VALID, salary: '' } as unknown as Data, noDocs, {}).salary).toBeUndefined()
    // officeEmail is required for Salaried (Vanilla wValidateOfficeEmail, salaried-only field).
    expect(computeStepErrors(5, { ...VALID, officeEmail: '' } as unknown as Data, noDocs, {}).officeEmail).toBeTruthy()
  })
  it('Step 5 (Salaried): Company Type + Office Address are required (Vanilla parity)', () => {
    const e = computeStepErrors(5, { ...VALID, compType: '', officeAddr1: '', officeAddr2: '', officePin: '' } as unknown as Data, noDocs, {})
    expect(e.compType).toBeTruthy(); expect(e.officeAddr1).toBeTruthy()
    expect(e.officeAddr2).toBeTruthy(); expect(e.officePin).toBeTruthy()
  })
  it('Step 5 (Self-employed): business vintage/turnover/net-profit/ITR/type required', () => {
    const SE = { ...VALID, empType: 'self_employed', compType: 'Proprietorship' } as unknown as Data
    const e = computeStepErrors(5, SE, noDocs, {})
    expect(e.bizVintage).toBeTruthy(); expect(e.annualTurnover).toBeTruthy()
    expect(e.netProfit).toBeTruthy(); expect(e.itrFiled).toBeTruthy(); expect(e.bizType).toBeTruthy()
  })
  it('Step 5 (Car): make/model/price/dealer required; used-car adds year+kms', () => {
    const CAR = computeStepErrors(5, { ...VALID, loanType: 'used_car' } as unknown as Data, noDocs, {})
    expect(CAR.vehicleMake).toBeTruthy(); expect(CAR.vehicleModel).toBeTruthy()
    expect(CAR.vehiclePrice).toBeTruthy(); expect(CAR.vehicleDealer).toBeTruthy()
    expect(CAR.vehicleMfgYear).toBeTruthy(); expect(CAR.vehicleKms).toBeTruthy()
  })
  it('Step 5 (Home Loan): property type/ownership required', () => {
    const e = computeStepErrors(5, { ...VALID, loanType: 'home_loan' } as unknown as Data, noDocs, {})
    expect(e.propertyType).toBeTruthy(); expect(e.propertyOwnership).toBeTruthy()
  })

  // Professional emp type is NOT self-employed, so it requires the firm/company
  // fields (incl. Professional Body) — and the wizard renders a Firm/Practice
  // block for it, so the path is completable.
  it('Step 5 (Professional): completable with firm fields; missing firm name → blocks', () => {
    const PRO = { ...VALID, empType: 'professional', professionalBody: 'ICAI' } as unknown as Data
    expect(Object.keys(computeStepErrors(5, PRO, noDocs, {})).length).toBe(0)
    expect(computeStepErrors(5, { ...PRO, compName: '' } as unknown as Data, noDocs, {}).compName).toBeTruthy()
    expect(computeStepErrors(5, { ...PRO, professionalBody: '' } as unknown as Data, noDocs, {}).professionalBody).toBeTruthy()
  })

  it('Step 6 (Offer): valid → no errors; amount<=0 → blocks', () => {
    expect(Object.keys(computeStepErrors(6, VALID, noDocs, {})).length).toBe(0)
    expect(computeStepErrors(6, { ...VALID, amount: '0' } as unknown as Data, noDocs, {}).amount).toBeTruthy()
  })
  it('Step 6: rate/purpose/CIBIL are NOT gated; only amount+tenure (Vanilla parity)', () => {
    // Vanilla validateStep(6) non-insurance gates ONLY loan amount + tenure.
    expect(computeStepErrors(6, { ...VALID, loanRate: '', purpose: '', cibil: '' } as unknown as Data, noDocs, {})).toEqual({})
    expect(computeStepErrors(6, { ...VALID, tenure: '' } as unknown as Data, noDocs, {}).tenure).toBeTruthy()
  })

  // Insurance product (Vanilla parity): Step 6 swaps to the policy field set,
  // where Tobacco / Smoker Status is a REQUIRED health declaration. Amount /
  // rate / tenure do NOT apply and must not be required for this product.
  it('Step 6 (Insurance): Tobacco/Smoker Status is required; loan fields are not', () => {
    const INS = {
      ...VALID, loanType: 'insurance',
      insType: 'Term Life', insSumAssured: '5000000', insPolicyTerm: '20',
      insPremiumFreq: 'Yearly', insPremium: '24000', insInsurer: 'HDFC Life',
      insNomineeName: 'Nominee', insNomineeRelation: 'Spouse', insNomineeDob: '1992-01-01', insNomineeId: 'ABCDE1234F',
      insTobaccoStatus: 'Non-Smoker / Non-Tobacco User', insOccupationHazard: 'Low Risk (Office / Professional)',
      insHeight: '172', insWeight: '70',
      amount: '', loanRate: '', tenure: '', purpose: '',
    } as unknown as Data
    // Fully valid insurance data → no errors (loan amount/rate/tenure absent is OK).
    expect(Object.keys(computeStepErrors(6, INS, noDocs, {})).length).toBe(0)
    // Missing Tobacco/Smoker Status → blocks with that specific error.
    const e = computeStepErrors(6, { ...INS, insTobaccoStatus: '' } as unknown as Data, noDocs, {})
    expect(e.insTobaccoStatus).toBeTruthy()
    // Nominee name also required for insurance.
    expect(computeStepErrors(6, { ...INS, insNomineeName: '' } as unknown as Data, noDocs, {}).insNomineeName).toBeTruthy()
  })

  // Step 7 (References): Vanilla requires BOTH references fully (Name + Mobile +
  // Relationship each, 10-digit mobiles). React previously accepted just one.
  it('Step 7 (References): both references required; one filled → still blocks', () => {
    const REF = {
      ...VALID,
      r1Name: 'Ref One', r1Mobile: '9876500012', r1Relation: 'Friend',
      r2Name: 'Ref Two', r2Mobile: '9876500013', r2Relation: 'Colleague',
    } as unknown as Data
    expect(Object.keys(computeStepErrors(7, REF, noDocs, {})).length).toBe(0)
    // Only reference 1 filled → reference 2 fields block.
    const e = computeStepErrors(7, { ...REF, r2Name: '', r2Mobile: '', r2Relation: '' } as unknown as Data, noDocs, {})
    expect(e.r2Name).toBeTruthy(); expect(e.r2Mobile).toBeTruthy(); expect(e.r2Relation).toBeTruthy()
    // Bad mobile format blocks too.
    expect(computeStepErrors(7, { ...REF, r1Mobile: '123' } as unknown as Data, noDocs, {}).r1Mobile).toBeTruthy()
  })
})
