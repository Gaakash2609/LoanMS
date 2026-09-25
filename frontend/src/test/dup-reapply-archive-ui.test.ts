import { describe, it, expect, beforeEach, vi } from 'vitest'

// pdf.js touches browser-only globals (DOMMatrix) at import time; the PDF
// tooling is irrelevant to these pages' markup, so it is stubbed here.
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve(null) }),
  PasswordResponses: {}, PasswordException: class extends Error {},
}))
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }))

// Server rendering reads a zustand store's INITIAL state (its server snapshot),
// so the persisted auth store is replaced by a plain, test-controlled one here.
vi.mock('@/store/authStore', () => {
  const state: Record<string, unknown> = {
    user: null, accessToken: 't', refreshToken: 'r', isAuthenticated: true, hasHydrated: true,
    setAuth() {}, setTokens() {}, logout() {}, setHasHydrated() {},
  }
  const hook = ((sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state)) as unknown as {
    (sel?: (s: typeof state) => unknown): unknown
    getState: () => typeof state
    setState: (p: Partial<typeof state>) => void
    subscribe: () => () => void
  }
  hook.getState = () => state
  hook.setState = (p) => { Object.assign(state, p) }
  hook.subscribe = () => () => {}
  return { useAuthStore: hook }
})
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { LOAN_KEYS } from '@/hooks/useLoans'
import LoanDetailPage from '@/pages/LoanDetailPage'
import LoansPage from '@/pages/LoansPage'
import { Step1, duplicateCheckKey } from '@/pages/wizard/steps/Step1'
import { emptyData } from '@/pages/wizard/wizardTypes'
import type { Loan } from '@/types'

// Server-rendered smoke tests of the real pages (no DOM library in this
// project): they prove the new archive / duplicate UI states render from the
// data the API returns, and that the Archive action is offered only where the
// backend allows it (role + closed/rejected + not yet archived).

const LOAN_ID = 5

function loan(over: Partial<Loan> = {}): Loan {
  return {
    id: LOAN_ID, loanNumber: 'EFIN20260000005', loanType: 'Personal', status: 'Rejected',
    requestedAmount: 100000, interestRate: 12, tenureMonths: 24, createdAt: new Date().toISOString(),
    customer: { id: 9, fullName: 'Test Customer', email: 't@x.test', phone: '9876543210' } as Loan['customer'],
    statusHistory: [], ...over,
  } as Loan
}

function signIn(role: string, id = 1) {
  useAuthStore.setState({ user: { id, role, fullName: 'U', email: 'u@x.test' } as never, isAuthenticated: true })
}

function renderDetail(l: Loan, userId = 1) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(LOAN_KEYS.detail(LOAN_ID, userId), l)
  return renderToString(
    h(QueryClientProvider, { client: qc },
      h(MemoryRouter, { initialEntries: [`/loans/${LOAN_ID}`] },
        h(Routes, null, h(Route, { path: '/loans/:id', element: h(LoanDetailPage) })))))
}

describe('Loan detail — archive', () => {
  beforeEach(() => useAuthStore.setState({ user: null, isAuthenticated: false }))

  it('shows the Archived badge and who/when/why for an archived application', () => {
    signIn('Admin')
    const html = renderDetail(loan({
      isArchived: true, archivedAt: '2026-09-24T10:00:00Z', archivedByName: 'Zonal Mgr', archiveReason: 'Duplicate lead',
    }))
    expect(html).toContain('Archived')
    expect(html).toContain('Zonal Mgr')
    expect(html).toContain('Duplicate lead')
    // an archived application can no longer be re-opened
    expect(html).not.toContain('Re-open (')
  })

  it('offers the action menu to ProductTeam only for a closed/rejected, not-yet-archived application', () => {
    // ProductTeam can't hold/reject/delete; the "More" menu appears only because Archive is available.
    signIn('ProductTeam')
    expect(renderDetail(loan({ status: 'Rejected' }))).toContain('More')
    expect(renderDetail(loan({ status: 'Closed' }))).toContain('More')
    for (const l of [loan({ status: 'UnderReview' }), loan({ status: 'Rejected', isArchived: true })]) {
      const html = renderDetail(l)
      expect(html).toContain('EFIN20260000005')   // the page really rendered the loan
      expect(html).not.toContain('More')
    }
  })

  it('never offers Archive to roles the backend refuses (Sales)', () => {
    signIn('Sales')
    const html = renderDetail(loan({ status: 'Rejected' }))
    expect(html).toContain('EFIN20260000005')
    expect(html).not.toContain('More')
  })
})

describe('Applications list — Archived view', () => {
  it('has an Archived tab next to Applications and Drafts', () => {
    signIn('Admin')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const html = renderToString(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(LoansPage))))
    expect(html).toMatch(/Applications[\s\S]*Archived[\s\S]*Drafts/)
  })
})

describe('Wizard step 1 — server-driven duplicate / re-application message', () => {
  it('shows the server message (e.g. the re-apply date) for the typed PAN + mobile', () => {
    signIn('Sales')
    const data = { ...emptyData, pan: 'ABCDE1234F', mobile: '9876543210' }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    qc.setQueryData(duplicateCheckKey(data, 11), {
      hasDuplicate: true, code: 'REAPPLY_COOLDOWN',
      message: 'Re-application allowed after 08 Nov 2026, 03:30 PM IST: rejected within 45 days.',
    })
    const html = renderToString(h(QueryClientProvider, { client: qc },
      h(Step1, { data, onChange: () => {}, errors: {}, touch: () => {}, draftLoanId: 11 })))
    expect(html).toContain('Re-application allowed after 08 Nov 2026')
  })
})
