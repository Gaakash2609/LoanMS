// FOIR / Loan-Eligibility engine — parity with legacy renderFoirPanel
// (efin-app.js:23458). Pure, side-effect-free calculation over data that is
// already persisted server-side (customer income / CIBIL / employment type;
// loan type / rate / tenure / amount; obligation EMIs). No persistence, no
// localStorage. The financial formulas REUSE utils/emi (reverseEmi().principal
// = legacy calcLoan / PV) — no duplicated math here.
import { reverseEmi } from './emi'

// Suggested FOIR — loan-type base + income tier + CIBIL + employment; clamped
// 40–80. Verbatim port of legacy getSuggestedFOIR.
export function suggestedFoirFor(loanType: string, isSelfEmp: boolean, income: number, cibil: number): number {
  let base = loanType === 'home_loan' ? 60
    : loanType === 'loan_against_property' ? 60
    : loanType === 'business_loan' ? 55
    : loanType === 'new_car_loan' || loanType === 'used_car_loan' ? 55
    : 50 // personal / others
  if (income >= 200000) base = Math.min(base + 15, 75)
  else if (income >= 100000) base = Math.min(base + 10, 70)
  else if (income >= 75000) base = Math.min(base + 5, 65)
  else if (income < 25000) base = Math.max(base - 5, 40)
  if (cibil >= 800) base = Math.min(base + 5, 75)
  else if (cibil >= 750) base = Math.min(base + 2, 72)
  else if (cibil < 650) base = Math.max(base - 8, 40)
  else if (cibil < 675) base = Math.max(base - 4, 42)
  if (isSelfEmp) base = Math.max(base - 3, 40)
  return Math.min(80, Math.max(40, Math.round(base)))
}

// Suggested ROI — CIBIL + loan-type matrix. Verbatim port of legacy
// getSuggestedROI / ROI_MATRIX. Used only when the loan's own stored rate is
// outside the plausible 6–36% band, exactly as legacy did.
const ROI_MATRIX: Record<string, { base: number; cibilAdj: { min: number; r: number }[] }> = {
  personal_loan:         { base: 14.0, cibilAdj: [{ min: 750, r: 11.5 }, { min: 720, r: 12.5 }, { min: 700, r: 13.5 }, { min: 675, r: 15.5 }, { min: 650, r: 18.0 }, { min: 0, r: 21.0 }] },
  business_loan:         { base: 15.0, cibilAdj: [{ min: 750, r: 12.5 }, { min: 720, r: 14.0 }, { min: 700, r: 15.5 }, { min: 675, r: 17.5 }, { min: 650, r: 20.0 }, { min: 0, r: 24.0 }] },
  home_loan:             { base: 9.0,  cibilAdj: [{ min: 800, r: 8.4 },  { min: 750, r: 8.75 }, { min: 720, r: 9.25 }, { min: 700, r: 9.75 }, { min: 675, r: 10.5 }, { min: 0, r: 11.5 }] },
  loan_against_property: { base: 11.0, cibilAdj: [{ min: 750, r: 9.5 },  { min: 720, r: 10.5 }, { min: 700, r: 11.5 }, { min: 675, r: 13.0 }, { min: 0, r: 15.0 }] },
  new_car_loan:          { base: 9.0,  cibilAdj: [{ min: 750, r: 7.5 },  { min: 720, r: 8.25 }, { min: 700, r: 9.0 },  { min: 675, r: 10.0 }, { min: 0, r: 12.0 }] },
  used_car_loan:         { base: 13.0, cibilAdj: [{ min: 750, r: 11.0 }, { min: 720, r: 12.0 }, { min: 700, r: 13.0 }, { min: 675, r: 15.0 }, { min: 0, r: 18.0 }] },
  education_loan:        { base: 9.5,  cibilAdj: [{ min: 750, r: 8.0 },  { min: 720, r: 9.0 },  { min: 700, r: 9.5 },  { min: 0, r: 11.0 }] },
  over_draft:            { base: 14.0, cibilAdj: [{ min: 750, r: 12.0 }, { min: 720, r: 13.5 }, { min: 700, r: 14.5 }, { min: 0, r: 17.0 }] },
  gold_loan:             { base: 9.5,  cibilAdj: [{ min: 0, r: 9.5 }] },
  tw_loan:               { base: 16.0, cibilAdj: [{ min: 750, r: 13.0 }, { min: 720, r: 14.5 }, { min: 700, r: 16.0 }, { min: 0, r: 19.0 }] },
}
export function suggestedRoiFor(loanType: string, cibil: number): number {
  const m = ROI_MATRIX[loanType] || ROI_MATRIX.personal_loan
  const entry = m.cibilAdj.find(e => cibil >= e.min)
  return entry ? entry.r : m.base
}

// Classify employment exactly as legacy did: the self-employed haircut/
// adjustments apply ONLY to an explicitly self-employed profile — an unknown/
// blank type is treated as full income (legacy's isSelfEmp was a strict
// equality, so blanks fell through to the salaried branch). Data carries many
// spellings (SALARIED / Salaried / SELFEMP / SENP / Self Employed / Business /
// Professional), so the check is substring-based on the upper-cased value.
export function isSelfEmployed(employmentType: string | null | undefined): boolean {
  return /SELF|SENP|BUSIN|PROF/.test((employmentType || '').toUpperCase())
}

export interface FoirObligation { loanEmi: number; selectBT: boolean }
export interface FoirInputs {
  grossIncome: number
  employmentType?: string | null
  loanType?: string | null
  cibil?: number | null
  tenureMonths?: number | null
  interestRate?: number | null
  requestedAmount?: number | null
  obligations: FoirObligation[]
  foirOverride?: number | null // null/undefined → use the suggested FOIR
  coAppIncome?: number
  // Self-employed only: net income from a Perfios-verified bank statement
  // (legacy's verifiedBankDoc.perfiosData.abb). When present and > 0 it is
  // preferred over the 70%-of-gross estimate, exactly as legacy renderFoirPanel
  // did. Ignored for salaried profiles.
  verifiedNetIncome?: number | null
}

export interface FoirResult {
  isSelfEmp: boolean
  // 'verified' = self-emp net income taken from a Perfios-verified statement;
  // 'estimated' = self-emp 70%-of-gross fallback; 'salaried' = gross as-is.
  netIncomeSource: 'verified' | 'estimated' | 'salaried'
  primaryNetIncome: number
  combinedIncome: number
  suggestedFoir: number
  effFoir: number
  rate: number
  goingEmi: number
  btEmi: number
  eligibleEmi: number
  netEligibleEmi: number
  actualFoirPct: number
  totalFoirAfter: number
  utilisationPct: number
  eligibleLoan: number
  maxPossible: number
  btBenefit: number
  loanDiff: number
  dscr: string
}

export function computeFoirEligibility(i: FoirInputs): FoirResult {
  const grossIncome = i.grossIncome || 0
  const isSelfEmp = isSelfEmployed(i.employmentType)
  const loanType = i.loanType || 'personal_loan'
  const cibil = i.cibil || 700
  const tenureMonths = i.tenureMonths || 36
  const requestedAmount = i.requestedAmount || 0

  // Self-employed net take-home: prefer a Perfios-verified bank-statement
  // figure when on file (legacy verifiedBankDoc.perfiosData.abb), else the
  // 70%-of-gross fallback estimate. Salaried uses gross as-is.
  const hasVerified = isSelfEmp && (i.verifiedNetIncome ?? 0) > 0
  const primaryNetIncome = isSelfEmp
    ? (hasVerified ? Math.round(i.verifiedNetIncome as number) : Math.round(grossIncome * 0.70))
    : grossIncome
  const netIncomeSource: FoirResult['netIncomeSource'] = isSelfEmp
    ? (hasVerified ? 'verified' : 'estimated')
    : 'salaried'
  const combinedIncome = primaryNetIncome + Math.max(0, i.coAppIncome || 0)

  const suggestedFoir = suggestedFoirFor(loanType, isSelfEmp, combinedIncome, cibil)
  const effFoir = Math.min(80, Math.max(40, i.foirOverride ?? suggestedFoir))

  const rate = i.interestRate && i.interestRate >= 6 && i.interestRate <= 36
    ? i.interestRate
    : suggestedRoiFor(loanType, cibil)

  const goingEmi = i.obligations.filter(o => !o.selectBT).reduce((s, o) => s + (o.loanEmi || 0), 0)
  const btEmi = i.obligations.filter(o => o.selectBT).reduce((s, o) => s + (o.loanEmi || 0), 0)

  const eligibleEmi = combinedIncome * effFoir / 100
  const netEligibleEmi = Math.max(0, eligibleEmi - goingEmi)
  const actualFoirPct = combinedIncome > 0 ? (goingEmi / combinedIncome) * 100 : 0
  const totalFoirAfter = combinedIncome > 0 ? ((goingEmi + netEligibleEmi) / combinedIncome) * 100 : 0
  const utilisationPct = eligibleEmi > 0 ? Math.min(100, Math.round((goingEmi / eligibleEmi) * 100)) : 0

  const eligibleLoan = Math.round(reverseEmi(netEligibleEmi, rate, tenureMonths).principal)
  const maxPossible = Math.round(reverseEmi(eligibleEmi, rate, tenureMonths).principal)
  const btBenefit = Math.round(reverseEmi(btEmi, rate, tenureMonths).principal)
  const loanDiff = eligibleLoan - requestedAmount
  const dscr = goingEmi > 0 ? (combinedIncome / goingEmi).toFixed(2) : '—'

  return {
    isSelfEmp, netIncomeSource, primaryNetIncome, combinedIncome, suggestedFoir, effFoir, rate,
    goingEmi, btEmi, eligibleEmi, netEligibleEmi, actualFoirPct, totalFoirAfter,
    utilisationPct, eligibleLoan, maxPossible, btBenefit, loanDiff, dscr,
  }
}
