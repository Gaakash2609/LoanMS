// ── Wizard Draft Storage ──────────────────────────────────────────────────
// Lightweight local persistence for in-progress "New Application" wizard
// sessions so users can leave and Resume later from Applications → Drafts.
//
// Scope note: this is purely additive — it does not touch the wizard's
// business logic, validation, or submit workflow. A draft is only ever
// read/written through the functions below, and a draft is only removed
// when (a) its own Resume flow is submitted successfully, (b) the user
// explicitly discards it from the Drafts list, or (c) it has expired
// (> 7 days old). Starting a new application always gets its own fresh
// draft id, so it can never overwrite or delete another draft.

const PREFIX = 'wizard_draft:'
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export interface WizardDraft<T = unknown> {
  id: string
  step: number
  data: T
  // Small denormalized fields for display in the Drafts list, so we don't
  // need to deserialize/inspect `data` just to render a table row.
  label: string
  loanType?: string
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

function isExpired(draft: WizardDraft): boolean {
  return Date.now() - draft.updatedAt > DRAFT_TTL_MS
}

export function saveDraft<T>(id: string, step: number, data: T, label: string, loanType?: string): void {
  try {
    const existingRaw = localStorage.getItem(key(id))
    const createdAt = existingRaw ? (JSON.parse(existingRaw) as WizardDraft<T>).createdAt : Date.now()
    const draft: WizardDraft<T> = {
      id, step, data, label, loanType,
      createdAt,
      updatedAt: Date.now(),
    }
    localStorage.setItem(key(id), JSON.stringify(draft))
  } catch {
    // Storage errors (quota, privacy mode, etc.) should never break the wizard.
  }
}

export function getDraft<T>(id: string): WizardDraft<T> | null {
  try {
    const raw = localStorage.getItem(key(id))
    if (!raw) return null
    const draft = JSON.parse(raw) as WizardDraft<T>
    if (isExpired(draft)) {
      localStorage.removeItem(key(id))
      return null
    }
    return draft
  } catch {
    return null
  }
}

/** Active (non-expired) drafts, newest first. Expired drafts are purged as a side effect. */
export function listDrafts<T = unknown>(): WizardDraft<T>[] {
  const drafts: WizardDraft<T>[] = []
  try {
    for (const k of Object.keys(localStorage)) {
      if (!k.startsWith(PREFIX)) continue
      try {
        const draft = JSON.parse(localStorage.getItem(k) || '') as WizardDraft<T>
        if (isExpired(draft)) {
          localStorage.removeItem(k)
          continue
        }
        drafts.push(draft)
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

export function deleteDraft(id: string): void {
  try {
    localStorage.removeItem(key(id))
  } catch {
    // no-op
  }
}
