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

export function buildAmortSchedule(P: number, annualRate: number, months: number) {
  const r = annualRate / 12 / 100
  const { emi } = emiReducing(P, annualRate, months)
  let balance = P
  const rows = []
  for (let m = 1; m <= months; m++) {
    const intPart  = balance * r
    const prinPart = Math.min(emi - intPart, balance)
    balance = Math.max(balance - prinPart, 0)
    rows.push({ m, emi, prin: prinPart, int: intPart, balance })
  }
  return rows
}
