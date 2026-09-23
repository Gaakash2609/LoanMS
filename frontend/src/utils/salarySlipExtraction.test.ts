import { describe, it, expect } from 'vitest'
import { parseSalarySlip, parseAmount, detectSalaryMonth } from './salarySlipExtraction'

describe('parseAmount', () => {
  it('strips currency symbols, commas and spaces', () => {
    expect(parseAmount('₹ 45,750.00')).toBe(45750)
    expect(parseAmount('Rs. 1,00,000')).toBe(100000)
    expect(parseAmount('INR 52000')).toBe(52000)
  })
  it('returns 0 for non-amounts', () => {
    expect(parseAmount('N/A')).toBe(0)
    expect(parseAmount(null)).toBe(0)
  })
})

describe('detectSalaryMonth', () => {
  it('prefers an explicit "for the month of" phrase', () => {
    expect(detectSalaryMonth('Payslip for the month of January 2026')).toBe('Jan 2026')
    expect(detectSalaryMonth('Salary Slip for March 2026\n...')).toBe('Mar 2026')
  })
  it('falls back to the first month+year pair', () => {
    expect(detectSalaryMonth('Employee: X\nFeb 2026 earnings')).toBe('Feb 2026')
  })
  it('returns null when no month present', () => {
    expect(detectSalaryMonth('Net Pay 50000')).toBeNull()
  })
})

describe('parseSalarySlip', () => {
  it('extracts net pay + month from a typical text payslip', () => {
    const text = [
      'ACME Corp Pvt Ltd', 'Payslip for the month of January 2026',
      'Employee: Ramesh Kumar', 'Gross Salary        75,000.00',
      'Total Deductions    12,250.00', 'Net Pay             ₹ 62,750.00',
    ].join('\n')
    const r = parseSalarySlip(text)
    expect(r.netPay).toBe(62750)
    expect(r.gross).toBe(75000)
    expect(r.month).toBe('Jan 2026')
  })

  it('handles net-pay synonyms (take home / in hand)', () => {
    expect(parseSalarySlip('Take Home: Rs. 48,500').netPay).toBe(48500)
    expect(parseSalarySlip('In-hand salary 55000').netPay).toBe(55000)
    expect(parseSalarySlip('Amount Credited 41,200.50').netPay).toBe(41200.5)
  })

  it('leaves fields null when not confidently found (manual entry fallback)', () => {
    const r = parseSalarySlip('Some unrelated document with no salary figures')
    expect(r.netPay).toBeNull()
    expect(r.month).toBeNull()
  })
})
