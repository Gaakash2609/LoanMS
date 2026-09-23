// ── CAM — Credit Assessment Memo ────────────────────────────────────────
// Transcribed from the legacy engine (efin-app.js:17105-17700). The matrix,
// the premium-employer list and the calculation below are the business rules
// the legacy wizard's Step-6 offer panel runs on; none of it is re-derived
// or "improved" here, because the numbers it produces are shown to customers
// as an eligibility offer.

export interface CamBand {
  label: string
  salaryMin: number
  salaryMax: number
  rateMin: number
  rateMax: number
  tenureMin: number
  tenureMax: number
  /** Fixed Obligation to Income Ratio, as a fraction (0.40 = 40%). */
  foir: number
}

/** efin-app.js:17105 — CAM_MATRIX_DEFAULT, verbatim. */
export const CAM_MATRIX_DEFAULT: CamBand[] = [
  { salaryMin: 15000, salaryMax: 20000, rateMin: 24, rateMax: 30, tenureMin: 24, tenureMax: 36, foir: 0.40, label: '15K to 20K' },
  { salaryMin: 20000, salaryMax: 25000, rateMin: 18, rateMax: 24, tenureMin: 36, tenureMax: 48, foir: 0.45, label: '20K to 25K' },
  { salaryMin: 20000, salaryMax: 25000, rateMin: 15, rateMax: 24, tenureMin: 36, tenureMax: 60, foir: 0.50, label: '20K to 25K' },
  { salaryMin: 25000, salaryMax: 30000, rateMin: 15, rateMax: 20, tenureMin: 48, tenureMax: 60, foir: 0.55, label: '25K to 30k' },
  { salaryMin: 35000, salaryMax: 45000, rateMin: 11, rateMax: 15, tenureMin: 48, tenureMax: 60, foir: 0.65, label: '35K to 45k' },
  { salaryMin: 45000, salaryMax: 50000, rateMin: 11, rateMax: 15, tenureMin: 60, tenureMax: 72, foir: 0.75, label: '45K to 50k >' },
  { salaryMin: 45000, salaryMax: 60000, rateMin: 11, rateMax: 15, tenureMin: 60, tenureMax: 84, foir: 0.75, label: '45K to 60k >' },
]

/**
 * efin-app.js:17351 — applicants at these employers get the boost below.
 *
 * The four placeholder entries the legacy list ended with — 'ABC Corporation',
 * 'XYZ Limited', 'LMN Industries', 'PQR Enterprises' — are deliberately NOT
 * carried over. They are the same demo employers the business owner already had
 * removed from the Lender Configuration seed (efin-app.js:15762-15764, "this was
 * demo/sample data ... not real bank config"); the CAM list was transcribed
 * before that cleanup and kept them. Leaving them in is not cosmetic here:
 * camIsPremiumEmployer() matches in BOTH directions, so any applicant whose
 * employer name contains — or is contained by — one of these strings is granted
 * a CAM_PREMIUM_BOOST uplift on the eligible amount that is then shown to the
 * customer as an offer. Real employers only.
 */
export const CAM_PREMIUM_COMPANIES = [
  'Tata Consultancy Services', 'Infosys', 'Wipro', 'HCL Technologies', 'Tech Mahindra',
  'Accenture', 'IBM', 'Cognizant', 'Capgemini', 'L&T Technology Services',
  'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank', 'State Bank of India',
  'Reliance Industries', 'Adani Group', 'Bajaj Finserv', 'Mahindra & Mahindra',
]

/** Minimum gross monthly income for any offer (efin-app.js:17434). */
export const CAM_MIN_SALARY = 15000
/** Premium-employer uplift on the eligible amount (efin-app.js:17477). */
export const CAM_PREMIUM_BOOST = 50000
/** Slider floor and step for the amount control (efin-app.js:17497). */
export const CAM_AMOUNT_MIN = 50000
export const CAM_AMOUNT_STEP = 5000

/** The generic AppSettings key the legacy admin panel saves the matrix to. */
export const CAM_MATRIX_SETTING_KEY = 'efin_cam_matrix'
export const CAM_MATRIX_SETTING_CATEGORY = 'Configuration'

/**
 * Legacy label rule (camAutoLabel, efin-app.js:17238) — regenerated from the
 * salary range on every save so the label can never drift from the numbers.
 */
export function camAutoLabel(salaryMin: number, salaryMax: number): string {
  const k = (v: number) => {
    const t = v / 1000
    return (Number.isInteger(t) ? t : t.toFixed(1)) + 'K'
  }
  return `${k(salaryMin)} to ${k(salaryMax)}`
}

export interface CamResult {
  /** null when the salary is below CAM_MIN_SALARY — no offer is made. */
  band: CamBand | null
  /** salary × FOIR − obligations, floored at 0. */
  maxEmi: number
  /** Eligible amount before the premium-employer boost. */
  maxLoan: number
  /** Boost actually applied (0 or CAM_PREMIUM_BOOST). */
  boost: number
  /** maxLoan + boost — the figure the amount slider maxes out at. */
  maxLoanWithBoost: number
  /** Midpoint of the band's rate range — the rate applied to the offer. */
  midRate: number
  isPremiumEmployer: boolean
}

/**
 * Band selection, verbatim from camCalculate (efin-app.js:17444): every band
 * whose salaryMin the applicant clears is a candidate, and the one with the
 * highest FOIR wins — which is why a salary above every range still lands on
 * the top band rather than falling through. salaryMax is deliberately not
 * part of the test; that mirrors legacy exactly.
 */
export function camMatchBand(salary: number, matrix: CamBand[]): CamBand | null {
  if (!matrix.length) return null
  let matched: CamBand | null = null
  for (const row of matrix) {
    if (salary >= row.salaryMin) {
      if (!matched || row.foir > matched.foir) matched = row
    }
  }
  return matched ?? matrix[matrix.length - 1]
}

export function camIsPremiumEmployer(companyName: string): boolean {
  const c = companyName.trim().toLowerCase()
  if (!c) return false
  // Legacy matches in both directions, so a stored "Infosys Ltd" and a typed
  // "Infosys" both hit. Kept as-is.
  return CAM_PREMIUM_COMPANIES.some(p => {
    const l = p.toLowerCase()
    return c.includes(l) || l.includes(c)
  })
}

/**
 * Full offer calculation — the pure core of camCalculate (efin-app.js:17426).
 * Returns band: null when no offer applies, so callers render the empty state
 * rather than a zero-value offer.
 */
export function camCalculate(
  salary: number,
  obligations: number,
  companyName: string,
  matrix: CamBand[],
): CamResult {
  const empty: CamResult = {
    band: null, maxEmi: 0, maxLoan: 0, boost: 0,
    maxLoanWithBoost: 0, midRate: 0, isPremiumEmployer: false,
  }
  if (!salary || salary < CAM_MIN_SALARY) return empty

  const band = camMatchBand(salary, matrix)
  if (!band) return empty

  const maxEmi = Math.max(0, salary * band.foir - obligations)
  const midRate = (band.rateMin + band.rateMax) / 2

  // Reducing-balance present value of maxEmi over the band's longest tenure.
  const r = midRate / 12 / 100
  const n = band.tenureMax
  const maxLoan = Math.max(0, Math.round(
    r > 0
      ? maxEmi * (Math.pow(1 + r, n) - 1) / (r * Math.pow(1 + r, n))
      : maxEmi * n,
  ))

  const isPremiumEmployer = camIsPremiumEmployer(companyName)
  const boost = isPremiumEmployer ? CAM_PREMIUM_BOOST : 0

  return {
    band,
    maxEmi,
    maxLoan,
    boost,
    maxLoanWithBoost: maxLoan + boost,
    midRate,
    isPremiumEmployer,
  }
}
