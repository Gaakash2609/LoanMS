// ── Wizard Draft Index (metadata only — NOT business data) ─────────────────
// The actual in-progress "New Application" wizard data (name, PAN, Aadhar,
// address, salary, references, ...) is business/PII data and is persisted
// ONLY server-side, via wizardApi.saveDraft -> POST /api/wizard/draft, into
// the real Loan+Customer tables. Resuming a draft reads that same data back
// from the server via wizardApi.getDraft -> GET /api/wizard/draft/{loanId}.
//
// What lives here in localStorage is a small, non-sensitive index — just
// enough to render the "Applications -> Drafts" list (which draft ids exist,
// what step they're on, when they were touched) and to remember which
// backend loanId a given local draft id maps to. If localStorage is cleared,
// nothing is lost except this convenience list: every draft still exists,
// and is still fully recoverable, in the database.

const PREFIX = 'wizard_draft_meta:'
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export interface WizardDraftMeta {
  id: string
  step: number
  // Small denormalized field for display in the Drafts list only.
  label: string
  loanType?: string
  // Links this local draft id to its backend Draft Loan record (see
  // wizardApi.saveDraft/getDraft) — this is what resuming actually uses to
  // fetch the real form data from the database.
  loanId?: number
  createdAt: number
  updatedAt: number
}

function key(id: string) {
  return `${PREFIX}${id}`
}

export function createDraftId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `d_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function isExpired(draft: WizardDraftMeta): boolean {
  return Date.now() - draft.updatedAt > DRAFT_TTL_MS
}

/** Record/update the draft's index entry (step, label, loanId) — no form data. */
export function saveDraftMeta(
  id: string, step: number, label: string, loanType?: string, loanId?: number
): void {
  try {
    const existingRaw = localStorage.getItem(key(id))
    const existing = existingRaw ? (JSON.parse(existingRaw) as WizardDraftMeta) : null
    const meta: WizardDraftMeta = {
      id, step, label, loanType,
      loanId: loanId ?? existing?.loanId,
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }
    localStorage.setItem(key(id), JSON.stringify(meta))
  } catch {
    // Storage errors (quota, privacy mode, etc.) should never break the wizard —
    // the backend draft (wizardApi.saveDraft) is the real persistence layer.
  }
}

export function getDraftMeta(id: string): WizardDraftMeta | null {
  try {
    const raw = localStorage.getItem(key(id))
    if (!raw) return null
    const meta = JSON.parse(raw) as WizardDraftMeta
    if (isExpired(meta)) {
      localStorage.removeItem(key(id))
      return null
    }
    return meta
  } catch {
    return null
  }
}

/** Active (non-expired) draft index entries, newest first. Expired entries are purged as a side effect. */
export function listDraftMetas(): WizardDraftMeta[] {
  const drafts: WizardDraftMeta[] = []
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(PREFIX)) continue
      try {
        const meta = JSON.parse(localStorage.getItem(k) || '') as WizardDraftMeta
        if (isExpired(meta)) {
          localStorage.removeItem(k)
          continue
        }
        drafts.push(meta)
      } catch {
        // Corrupt entry — drop it rather than let it break the list.
        localStorage.removeItem(k)
      }
    }
  } catch {
    // localStorage unavailable — return whatever we found (likely nothing).
  }
  return drafts.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function deleteDraftMeta(id: string): void {
  try {
    localStorage.removeItem(key(id))
  } catch {
    // no-op
  }
}
