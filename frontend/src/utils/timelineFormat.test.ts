import { describe, it, expect } from 'vitest'
import { stageBadgeClass, trackingStatusClass, routeDisplay, classifyComment, buildFormattedComment } from './timelineFormat'

// These mirror legacy renderTrackingSection (efin-app.js:3258-3343). The point
// of each case is 1:1 parity: React must produce the same class / column /
// comment-type Vanilla would for identical tracking data.

describe('stageBadgeClass', () => {
  it('maps the exact legacy stage strings to their coloured pill', () => {
    expect(stageBadgeClass('Admin')).toBe('stage-Admin')
    expect(stageBadgeClass('PAR_DEP')).toBe('stage-PAR_DEP')
    expect(stageBadgeClass('CPA_Dep')).toBe('stage-CPA_Dep')
    expect(stageBadgeClass('Sales')).toBe('stage-Sales')
    expect(stageBadgeClass('System')).toBe('stage-System')
  })

  it('hyphenates spaces only for a listed stage (System-Comments)', () => {
    expect(stageBadgeClass('System-Comments')).toBe('stage-System-Comments')
  })

  it('falls back to stage-default for dept names and unlisted stages', () => {
    // These are what React actually writes as `stage` (useCurrentUserDept), so
    // this is the common case — and legacy renders stage-default for them too.
    expect(stageBadgeClass('Login Dep')).toBe('stage-default')
    expect(stageBadgeClass('Sales Dep')).toBe('stage-default')
    expect(stageBadgeClass('Team Dep')).toBe('stage-default')
    // Legacy quirk kept verbatim: "System Comments" (space) is NOT in the list
    // (only the hyphenated "System-Comments" is), so it is stage-default.
    expect(stageBadgeClass('System Comments')).toBe('stage-default')
    expect(stageBadgeClass('')).toBe('stage-default')
  })
})

describe('routeDisplay (comment vs sub-note column)', () => {
  it('routes comment-only tasks to the Comment column, blanking Sub Note', () => {
    const r = routeDisplay({ name: 'EFIN-Income Check - CPA', comment: 'Avg ₹50,000', subNote: 'ignored' })
    expect(r).toEqual({ comment: 'Avg ₹50,000', subNote: '' })
  })

  it('routes sub-note-only tasks to the Sub Note column, showing — in Comment', () => {
    const r = routeDisplay({ name: 'EFIN- Bank Details Check', comment: 'ignored', subNote: 'IFSC: HDFC0001' })
    expect(r).toEqual({ comment: '—', subNote: 'IFSC: HDFC0001' })
  })

  it('gives COMMENT_ONLY precedence for a task in both sets (EFIN-Deviation)', () => {
    const r = routeDisplay({ name: 'EFIN-Deviation', comment: 'dev note', subNote: 'sub' })
    expect(r).toEqual({ comment: 'dev note', subNote: '' })
  })

  it('shows both columns for a normal task', () => {
    const r = routeDisplay({ name: 'EFIN-Nach', comment: 'done', subNote: 'ref 123' })
    expect(r).toEqual({ comment: 'done', subNote: 'ref 123' })
  })

  it('renders — for an empty comment on a normal task', () => {
    const r = routeDisplay({ name: 'EFIN-Nach', comment: '', subNote: '' })
    expect(r).toEqual({ comment: '—', subNote: '' })
  })
})

describe('classifyComment (comment-type badge detection)', () => {
  it('parses a Pending Documents block into docItems + note', () => {
    const raw = '📋 PENDING DOCUMENTS REQUIRED\n────────\n• Salary Slip\n• Bank Statement\nNote: submit by Friday'
    const info = classifyComment(raw)
    expect(info).toEqual({ type: 'pending', docItems: ['Salary Slip', 'Bank Statement'], note: 'submit by Friday' })
  })

  it('parses a Pending Documents block with no note', () => {
    const info = classifyComment('📋 PENDING DOCUMENTS REQUIRED\n────\n• PAN Card')
    expect(info).toEqual({ type: 'pending', docItems: ['PAN Card'] })
  })

  it('strips the header from a Query block', () => {
    const info = classifyComment('❓ QUERY / ISSUE\n────\nAddress mismatch on KYC')
    expect(info).toEqual({ type: 'query', body: 'Address mismatch on KYC' })
  })

  it('strips the header from a Task Update block', () => {
    const info = classifyComment('✅ TASK UPDATE\n────\nRe-KYC completed')
    expect(info).toEqual({ type: 'task', body: 'Re-KYC completed' })
  })

  it('treats any other non-empty comment as a general update', () => {
    const info = classifyComment('Called customer, will submit tomorrow')
    expect(info).toEqual({ type: 'general', body: 'Called customer, will submit tomorrow' })
  })

  it('returns "none" with an em-dash for empty / dash comments', () => {
    expect(classifyComment('')).toEqual({ type: 'none', body: '—' })
    expect(classifyComment('—')).toEqual({ type: 'none', body: '—' })
    expect(classifyComment(null)).toEqual({ type: 'none', body: '—' })
  })
})

describe('buildFormattedComment (manual-comment create side)', () => {
  const RULE = '─'.repeat(32)

  it('general = trimmed raw text', () => {
    expect(buildFormattedComment('general', '  hello  ')).toBe('hello')
    expect(buildFormattedComment('general', '')).toBe('')
  })

  it('query wraps with the exact legacy header and round-trips via classifyComment', () => {
    const s = buildFormattedComment('query', 'CIBIL mismatch noticed')
    expect(s).toBe(`❓ QUERY / ISSUE\n${RULE}\nCIBIL mismatch noticed`)
    expect(classifyComment(s)).toEqual({ type: 'query', body: 'CIBIL mismatch noticed' })
    expect(buildFormattedComment('query', '')).toBe('')
  })

  it('task wraps with the exact legacy header and round-trips', () => {
    const s = buildFormattedComment('task', 'Login completed')
    expect(s).toBe(`✅ TASK UPDATE\n${RULE}\nLogin completed`)
    expect(classifyComment(s)).toEqual({ type: 'task', body: 'Login completed' })
  })

  it('pending with docs + note round-trips through classifyComment', () => {
    const s = buildFormattedComment('pending', 'submit by Friday', ['PAN Card', 'Bank Statement (6 months)'])
    expect(classifyComment(s)).toEqual({ type: 'pending', docItems: ['PAN Card', 'Bank Statement (6 months)'], note: 'submit by Friday' })
  })

  it('pending with docs and no note omits the Note line', () => {
    const s = buildFormattedComment('pending', '', ['PAN Card'])
    expect(classifyComment(s)).toEqual({ type: 'pending', docItems: ['PAN Card'] })
  })

  it('pending with only a note (no docs) degrades to a plain comment (legacy)', () => {
    expect(buildFormattedComment('pending', 'just a note', [])).toBe('just a note')
  })

  it('pending with nothing yields an empty comment', () => {
    expect(buildFormattedComment('pending', '', [])).toBe('')
  })
})

describe('trackingStatusClass — Vanilla badge-${status} treatment', () => {
  it('Complete / COMPLETE → red (legacy .badge-Complete)', () => {
    expect(trackingStatusClass('Complete')).toBe('trk-status-complete')
    expect(trackingStatusClass('COMPLETE')).toBe('trk-status-complete')
  })
  it('Pending → amber (legacy .badge-Pending)', () => {
    expect(trackingStatusClass('Pending')).toBe('trk-status-pending')
  })
  it('SKIP → grey (legacy .badge-SKIP)', () => {
    expect(trackingStatusClass('SKIP')).toBe('trk-status-skip')
  })
  it('every other status falls through to the base badge (legacy has no rule)', () => {
    expect(trackingStatusClass('In Progress')).toBe('')
    expect(trackingStatusClass('On Hold')).toBe('')
    expect(trackingStatusClass('Move')).toBe('')
  })
})
