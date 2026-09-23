import { describe, it, expect } from 'vitest'
import { serializePerfiosReport, deserializePerfiosReport } from './persist'
import type { PerfiosUploadResult } from '@/hooks/usePerfiosUpload'
import type { Transaction } from './types'

function txn(dateISO: string, over: Partial<Transaction> = {}): Transaction {
  return {
    date: new Date(dateISO),
    desc: over.desc ?? 'NEFT SALARY ACME CORP',
    rawDesc: over.rawDesc ?? 'NEFT-SALARY-ACME',
    type: over.type ?? 'CR',
    amount: over.amount ?? 55000,
    balance: over.balance ?? 120000,
    category: over.category ?? 'Salary',
    ...over,
  }
}

function sampleResult(): PerfiosUploadResult {
  const t1 = txn('2026-03-02T00:00:00Z', { amount: 55000, type: 'CR', category: 'Salary' })
  const t2 = txn('2026-04-01T00:00:00Z', { desc: 'UPI-ZOMATO', rawDesc: 'UPI/ZOMATO', type: 'DR', amount: 480, balance: 119520, category: 'Food' })
  return {
    valid: true,
    span: 92,
    staledays: 3,
    firstDate: new Date('2026-03-02T00:00:00Z'),
    lastDate: new Date('2026-06-02T00:00:00Z'),
    abb: 118250.5,
    totalTxns: 2,
    allTxns: [t1, t2],
    filtered90: [t1, t2],
    salaryTxns: [t1],
    hasSalary: true,
    achTxns: [],
    ecsTxns: [],
    neftTxns: [t1],
    upiTxns: [t2],
    chequeTxns: [],
    bounceTxns: [],
    overdraftTxns: [],
    hasBounces: false,
    validChecks: [
      { id: 'span', status: 'pass', icon: '✅', title: 'Statement span', detail: '92 days', value: '92d' },
    ],
    accountInfo: { bank: 'HDFC Bank', accountNo: 'XXXX1234', name: 'ASHA RAO', ifsc: 'HDFC0000123' },
    openingBalance: 65000,
    abbData: {
      '2026-03': { label: 'Mar 26', dates: { 2: 65000, 10: 70000 }, credits: 55000, creditCount: 1, debitCount: 1, debitTotal: 480 },
    },
    monthOrder: ['2026-03'],
    perFileData: [{ fileName: 'HDFC_Statement.pdf', fileSize: 128000, isProtected: false, txnCount: 2 }],
    manualReviewRequired: false,
    staleAttempts: 0,
  }
}

describe('perfios persist', () => {
  it('round-trips a full report, reviving Date fields to real Date objects', () => {
    const original = sampleResult()
    const json = serializePerfiosReport(original)
    expect(typeof json).toBe('string')

    const revived = deserializePerfiosReport(json)
    if (!revived) throw new Error('expected a non-null revived report')

    // Scalars preserved.
    expect(revived.valid).toBe(true)
    expect(revived.span).toBe(92)
    expect(revived.staledays).toBe(3)
    expect(revived.abb).toBeCloseTo(118250.5, 5)
    expect(revived.totalTxns).toBe(2)
    expect(revived.hasSalary).toBe(true)
    expect(revived.hasBounces).toBe(false)
    expect(revived.manualReviewRequired).toBe(false)
    expect(revived.openingBalance).toBe(65000)

    // Top-level dates are real Date objects with the same instant.
    expect(revived.firstDate).toBeInstanceOf(Date)
    expect(revived.lastDate).toBeInstanceOf(Date)
    expect(revived.firstDate.getTime()).toBe(original.firstDate.getTime())
    expect(revived.lastDate.getTime()).toBe(original.lastDate.getTime())

    // Every transaction's date revived to a Date with the same instant.
    expect(revived.allTxns).toHaveLength(2)
    revived.allTxns.forEach((t, i) => {
      expect(t.date).toBeInstanceOf(Date)
      expect(t.date.getTime()).toBe(original.allTxns[i].date.getTime())
    })
    expect(revived.allTxns[0].amount).toBe(55000)
    expect(revived.allTxns[0].type).toBe('CR')
    expect(revived.salaryTxns).toHaveLength(1)
    expect(revived.neftTxns[0].date).toBeInstanceOf(Date)
    expect(revived.upiTxns[0].desc).toBe('UPI-ZOMATO')

    // Nested structures preserved.
    expect(revived.accountInfo.bank).toBe('HDFC Bank')
    expect(revived.monthOrder).toEqual(['2026-03'])
    expect(revived.abbData['2026-03'].label).toBe('Mar 26')
    expect(revived.validChecks[0].status).toBe('pass')
    expect(revived.perFileData[0].fileName).toBe('HDFC_Statement.pdf')
  })

  it('returns null for null/blank/corrupt input instead of throwing', () => {
    expect(serializePerfiosReport(null)).toBeNull()
    expect(serializePerfiosReport(undefined)).toBeNull()
    expect(deserializePerfiosReport(null)).toBeNull()
    expect(deserializePerfiosReport('')).toBeNull()
    expect(deserializePerfiosReport('{not json')).toBeNull()
    expect(deserializePerfiosReport('"a string"')).toBeNull()
  })

  it('tolerates a report with empty arrays / missing optional fields', () => {
    const revived = deserializePerfiosReport(JSON.stringify({ __v: 1, valid: false }))
    if (!revived) throw new Error('expected a non-null revived report')
    expect(revived.valid).toBe(false)
    expect(revived.allTxns).toEqual([])
    expect(revived.validChecks).toEqual([])
    expect(revived.monthOrder).toEqual([])
    expect(revived.firstDate).toBeInstanceOf(Date)
  })
})
