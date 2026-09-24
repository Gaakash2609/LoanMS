import { describe, it, expect } from 'vitest'
import { advToServerFilter, EMPTY_ADV_FILTER } from './advFilter'

describe('advToServerFilter', () => {
  it('sends every Advanced Filter key to the server under the LoanFilterDto name', () => {
    const f = advToServerFilter({
      ...EMPTY_ADV_FILTER,
      status: 'Approved', loanType: 'Personal',
      amountMin: '100000', amountMax: '500000', cibilMin: '650', cibilMax: '900',
      salaryMin: '30000', salaryMax: '90000',
      salesPerson: ' Asha Sales ', location: 'Pune', channel: 'walk-in', bank: 'HDFC',
      purpose: 'personal_use', empType: 'Salaried', city: 'Pune', state: 'MH', gender: 'F',
      dsaName: 'DSA One', linkedPartner: 'Partner One', companyName: 'Acme',
    })
    expect(f).toMatchObject({
      status: 'Approved', loanType: 'Personal',
      minAmount: 100000, maxAmount: 500000, minCibil: 650, maxCibil: 900,
      minSalary: 30000, maxSalary: 90000,
      salesPerson: 'Asha Sales', location: 'Pune', channel: 'walk-in', bank: 'HDFC',
      purpose: 'personal_use', empType: 'Salaried', city: 'Pune', state: 'MH', gender: 'F',
      dsaName: 'DSA One', partnerName: 'Partner One', companyName: 'Acme',
    })
  })

  it('clears every key for an empty filter (so "Clear all" removes them from the query)', () => {
    const f = advToServerFilter(EMPTY_ADV_FILTER)
    expect(Object.values(f).every(v => v === undefined)).toBe(true)
    expect(Object.keys(f)).toContain('partnerName')
  })

  it('turns a custom date range into dateFrom/dateTo', () => {
    const f = advToServerFilter({ ...EMPTY_ADV_FILTER, dateMode: 'custom', dateFrom: '2026-01-01', dateTo: '2026-01-31' })
    expect(f.dateFrom).toBe('2026-01-01')
    expect(f.dateTo).toBe('2026-01-31')
  })
})
