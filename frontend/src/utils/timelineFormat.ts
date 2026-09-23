// ── Timeline (loan-detail Timeline tab) formatting helpers ───────────────────
// Pure ports of legacy renderTrackingSection's display logic
// (efin-app.js:3258-3343), extracted so the embedded TrackingTable and its
// tests share one source of truth. Rendering (JSX/badges) lives in
// TrackingPage; this module is string-in / data-out only.

// Only these exact stage strings get a coloured pill in Vanilla; everything
// else (dept names like "Login Dep", "Sales Dep", or "System Comments" — note
// the space, which is NOT the hyphenated "System-Comments" below) falls through
// to `stage-default`. Kept verbatim so React renders the same class Vanilla
// would for identical data.
export const LEGACY_STAGE_CLASSES = [
  'PAR_DEP', 'CPA_Dep', 'CPA_DOCS', 'Admin', 'Login', 'Team',
  'Assign', 'System', 'System-Comment', 'System-Comments', 'Sales',
] as const

export function stageBadgeClass(stage: string): string {
  return (LEGACY_STAGE_CLASSES as readonly string[]).includes(stage)
    ? 'stage-' + stage.replace(/\s/g, '-')
    : 'stage-default'
}

// Tracking-entry STATUS badge colour — verbatim to Vanilla's own `.badge-*`
// treatment (app.css:2999-3016 / 5366-5371), NOT a design-system variant map.
// Vanilla renders `<span class="badge badge-${t.status}">`, and only these
// exact statuses get a colour: Complete/COMPLETE → red tint on --accent2,
// Pending → amber/--warn, SKIP → grey. Every other status ("In Progress",
// "On Hold", "Move", …) has no matching `.badge-*` rule and so falls through
// to the plain base badge — reproduced here by returning '' (base only).
export function trackingStatusClass(status: string): string {
  const s = (status || '').toUpperCase()
  if (s === 'COMPLETE') return 'trk-status-complete'
  if (s === 'PENDING') return 'trk-status-pending'
  if (s === 'SKIP') return 'trk-status-skip'
  return ''
}

// Task types that route their whole formatted block to a single column.
// COMMENT_ONLY takes precedence when a name is in both (matches legacy's
// if / else-if order: EFIN-Deviation appears in both and is treated as
// comment-only).
export const SUB_NOTE_ONLY_TASKS = new Set([
  'EFIN-Approved', 'EFIN-Deviation', 'EFIN- SKIP Deviation',
  'EFIN-Approved Deviation', 'EFIN-Disbursed', 'EFIN- Bank Details Check',
])
export const COMMENT_ONLY_TASKS = new Set([
  'EFIN-Income Check - CPA', 'EFIN-Deviation', 'EFIN-Charge',
])

export function routeDisplay(
  e: { name: string; comment?: string | null; subNote?: string | null },
): { comment: string; subNote: string } {
  if (COMMENT_ONLY_TASKS.has(e.name)) return { comment: e.comment || '—', subNote: '' }
  if (SUB_NOTE_ONLY_TASKS.has(e.name)) return { comment: '—', subNote: e.subNote || '' }
  return { comment: e.comment || '—', subNote: e.subNote || '' }
}

// Comment-type detection from the text prefix (legacy editableCell,
// efin-app.js:3287-3323). Returns structured data; TrackingPage turns it into
// the badge + body markup.
export type CommentInfo =
  | { type: 'pending'; docItems: string[]; note?: string }
  | { type: 'query' | 'task' | 'general' | 'none'; body: string }

// The 12 predefined docs in legacy's Pending-Docs checklist (index.html
// #tm-doc-checklist) — offered as quick toggles in the manual-comment form.
export const PENDING_DOC_OPTIONS = [
  'PAN Card', 'Aadhaar Card', 'Salary Slips (3 months)', 'Bank Statement (6 months)',
  'Form 16', 'ITR (2 years)', 'Appointment Letter', 'Offer Letter',
  'Property Documents', 'NOC from existing lender', 'NACH / ECS Mandate', 'Photo',
] as const

export type CommentType = 'general' | 'query' | 'pending' | 'task'

// Pure port of legacy `_buildFormattedComment` (efin-app.js:3584): turns the
// selected comment type + raw text (+ checked docs for 'pending') into the
// exact prefixed string the timeline renders as a typed badge. Inverse of
// classifyComment() below, so a comment can be created here and parsed back
// for editing. 32 em-dashes verbatim, matching the legacy separator.
export function buildFormattedComment(type: CommentType, rawComment: string, docItems: string[] = []): string {
  const raw = (rawComment || '').trim()
  const rule = '─'.repeat(32)
  if (type === 'pending') {
    const docs = docItems.map(d => d.trim()).filter(Boolean)
    if (!docs.length && !raw) return ''
    if (!docs.length) return raw
    const note = raw ? `\nNote: ${raw}` : ''
    return `📋 PENDING DOCUMENTS REQUIRED\n${rule}\n${docs.map(d => `• ${d}`).join('\n')}${note}`
  }
  if (type === 'query') return raw ? `❓ QUERY / ISSUE\n${rule}\n${raw}` : ''
  if (type === 'task') return raw ? `✅ TASK UPDATE\n${rule}\n${raw}` : ''
  return raw
}

export function classifyComment(text: string | null | undefined): CommentInfo {
  const raw = text || ''
  if (raw.startsWith('📋 PENDING DOCUMENTS REQUIRED')) {
    const docItems = raw.split('\n').filter(l => l.startsWith('•')).map(l => l.replace('• ', ''))
    const note = raw.match(/\nNote: (.+)/)?.[1]
    return note ? { type: 'pending', docItems, note } : { type: 'pending', docItems }
  }
  if (raw.startsWith('❓ QUERY / ISSUE')) {
    return { type: 'query', body: raw.replace(/^❓ QUERY \/ ISSUE\n─+\n/, '') }
  }
  if (raw.startsWith('✅ TASK UPDATE')) {
    return { type: 'task', body: raw.replace(/^✅ TASK UPDATE\n─+\n/, '') }
  }
  if (raw && raw !== '—') {
    return { type: 'general', body: raw }
  }
  return { type: 'none', body: raw || '—' }
}
