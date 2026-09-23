/**
 * EMI calculations — exact same formulas as legacy efin-app.js
 * _emiReducing and _emiFlat (window.18474-18475)
 */

export function emiReducing(P: number, annualRate: number, months: number) {
  if (P <= 0 || months <= 0) return { emi: 0, total: 0, totalInt: 0 }
  const r = annualRate / 12 / 100
  if (r === 0) return { emi: P / months, total: P, totalInt: 0 }
  const emi = (P * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1)
  const total = emi * months
  return { emi, total, totalInt: total - P }
}

export function emiFlat(P: number, annualRate: number, months: number) {
  if (P <= 0 || months <= 0) return { emi: 0, total: 0, totalInt: 0 }
  const totalInt = P * (annualRate / 100) * (months / 12)
  const total = P + totalInt
  return { emi: total / months, total, totalInt }
}

/**
 * Prepayment impact — how much tenure and interest an extra monthly payment
 * saves. Mirrors legacy calcPrepay(): the EMI stays as originally scheduled
 * and the extra amount goes straight to principal each month from
 * `startMonth` onwards.
 */
export function calcPrepayment(
  P: number, annualRate: number, months: number, extraPerMonth: number, startMonth = 1,
) {
  const base = emiReducing(P, annualRate, months)
  if (P <= 0 || months <= 0 || extraPerMonth <= 0) {
    return { ...base, newMonths: months, monthsSaved: 0, newTotalInt: base.totalInt, interestSaved: 0 }
  }
  const r = annualRate / 12 / 100
  const emi = base.emi
  // Verbatim port of legacy calcPrepay()'s loop (efin-app.js:11530-11545):
  // simulate up to 3× the original tenure, treat a balance under ₹0.5 as
  // closed, and add the extra straight to principal from `startMonth` onwards.
  // (The migration had used a `balance > 0 && m < months` bound with a
  // `prinPart <= 0` break — same result on normal inputs, but off-by-one on
  // the rare tail where the closing balance lands between 0 and 0.5.)
  let balance = P
  let newTotalInt = 0
  let m = 0
  while (balance > 0.5 && m < months * 3) {
    m++
    const intPart = balance * r
    const payment = emi + (m >= startMonth ? extraPerMonth : 0)
    const prinPart = Math.min(payment - intPart, balance)
    newTotalInt += intPart
    balance = Math.max(balance - prinPart, 0)
  }
  return {
    ...base,
    newMonths: m,
    monthsSaved: Math.max(months - m, 0),
    newTotalInt,
    interestSaved: Math.max(base.totalInt - newTotalInt, 0),
  }
}

/**
 * Reverse EMI — the maximum principal affordable for a given EMI.
 * Mirrors legacy calcReverse()/computeReverseLoan(): the reducing-balance
 * inversion (_reverseLoanReducing) AND the flat-rate inversion
 * (_reverseLoanFlat, efin-app.js:11565-11583). The Reverse tab's
 * Reducing/Flat toggle picks the method; the migration had dropped the
 * flat path entirely.
 */
export type ReverseMethod = 'reducing' | 'flat'
export function reverseEmi(
  targetEmi: number, annualRate: number, months: number, method: ReverseMethod = 'reducing',
) {
  if (targetEmi <= 0 || months <= 0) return { principal: 0, total: 0, totalInt: 0 }
  const total = targetEmi * months
  if (method === 'flat') {
    // EMI = (P + P·R·n/12) / n  ⟹  P = EMI·n / (1 + R·n/12)
    const R = annualRate / 100
    const principal = total / (1 + (R * months) / 12)
    return { principal, total, totalInt: total - principal }
  }
  const r = annualRate / 12 / 100
  const principal = r === 0
    ? total
    : (targetEmi * (Math.pow(1 + r, months) - 1)) / (r * Math.pow(1 + r, months))
  return { principal, total, totalInt: total - principal }
}

export function buildAmortSchedule(P: number, annualRate: number, months: number) {
  const r = annualRate / 12 / 100
  const { emi } = emiReducing(P, annualRate, months)
  let balance = P
  const rows: { m: number; emi: number; prin: number; int: number; balance: number }[] = []
  for (let m = 1; m <= months; m++) {
    const intPart  = balance * r
    const prinPart = Math.min(emi - intPart, balance)
    balance = Math.max(balance - prinPart, 0)
    rows.push({ m, emi, prin: prinPart, int: intPart, balance })
  }
  return rows
}

/**
 * Flat-rate amortisation — legacy's flat-mode schedule (efin-app.js:11338-11349):
 * equal principal every month, with interest on the straight-line-reducing
 * balance. Distinct from buildAmortSchedule (reducing balance) — the React
 * migration wrongly used the reducing schedule for BOTH calc types, so the
 * per-row Principal/Interest split was wrong whenever Flat Rate was selected.
 */
export function buildFlatAmortSchedule(P: number, annualRate: number, months: number) {
  if (P <= 0 || months <= 0) return []
  const monthlyPrin = P / months
  return Array.from({ length: months }, (_, i) => {
    const m = i + 1
    const int = (P - monthlyPrin * i) * (annualRate / 100 / 12)
    const balance = Math.max(P - monthlyPrin * m, 0)
    return { m, emi: monthlyPrin + int, prin: monthlyPrin, int, balance }
  })
}

/**
 * Bundled loan amount — the sanction-time figure that folds the processing fee
 * (plus GST on it) and/or the insurance premium into the financed principal,
 * exactly as legacy's laAutoCalc (efin-app.js:31848). GST defaults to 18% when
 * unset, matching legacy's `|| 18`. Each component is only added when its
 * "finance into the loan" toggle is on; otherwise it is paid up-front and does
 * not inflate the principal. Pure — no persistence, no side effects.
 */
export interface BundledInputs {
  amount: number
  pfPercent?: number | null
  gstPercent?: number | null
  insurance?: number | null
  pfInBundled?: boolean | null
  insuranceInBundled?: boolean | null
}
export function computeBundledAmount(i: BundledInputs) {
  const amount = i.amount || 0
  const pfPercent = i.pfPercent || 0
  const gstPercent = i.gstPercent ?? 18
  const insurance = i.insurance || 0
  const pf = (amount * pfPercent) / 100
  const pfWithGst = pf * (1 + gstPercent / 100)
  const bundled = Math.round(
    amount + (i.pfInBundled ? pfWithGst : 0) + (i.insuranceInBundled ? insurance : 0),
  )
  return { pf, pfWithGst, bundled }
}

/**
 * Reducing-balance → flat-rate conversion (tenure-aware). Verbatim port of the
 * flat-rate auto-calc in legacy laAutoCalc: FlatRate = totalInterest / (P·n/12)
 * where P cancels, so it depends only on ROI and tenure. Returns a percentage
 * rounded to 2dp (legacy's `.toFixed(2)`).
 */
export function flatRateFromReducing(annualRate: number, months: number): number {
  const n = months || 36
  const r = annualRate / 12 / 100
  const factor = Math.pow(1 + r, n)
  const emiPerRupee = r > 0 ? (r * factor) / (factor - 1) : 1 / n
  return +(((emiPerRupee * n - 1) / (n / 12)) * 100).toFixed(2)
}

/** Collapses a monthly schedule into per-year rows (legacy's Yearly toggle). */
export function toYearlySchedule(rows: ReturnType<typeof buildAmortSchedule>) {
  const years: { year: number; emi: number; prin: number; int: number; balance: number }[] = []
  rows.forEach(r => {
    const y = Math.ceil(r.m / 12)
    const cur = years[y - 1] ?? { year: y, emi: 0, prin: 0, int: 0, balance: 0 }
    cur.emi += r.emi; cur.prin += r.prin; cur.int += r.int
    cur.balance = r.balance // closing balance of the last month in the year
    years[y - 1] = cur
  })
  return years
}
