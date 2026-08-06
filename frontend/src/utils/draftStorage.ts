// ── Wizard Draft Index — server-backed ──────────────────────────────────────
// The in-progress "New Application" wizard's actual data (name, PAN, Aadhar,
// address, salary, references, ...) is business/PII data and is persisted
// server-side only, via wizardApi.saveDraft -> POST /api/wizard/draft, into
// the real Loan+Customer tables. Resuming a draft reads that same data back
// via wizardApi.getDraft -> GET /api/wizard/draft/{loanId}.
//
// The small index needed to render the "Applications -> Drafts" list (which
// draft ids exist, what step they're on, when they were last touched) used
// to live in browser localStorage (wizard_draft_meta:* keys) — a draft
// started on one device/browser was invisible everywhere else. It now comes
// straight from the database via wizardApi.listDrafts -> GET
// /api/wizard/drafts, backed by the new Loan.WizardStep column. Nothing
// about a draft is stored in localStorage anymore.

import { wizardApi, type WizardDraftSummary } from '@/api/wizardApi'

export type { WizardDraftSummary }

/** Generates a fresh client-side id for a brand-new (not-yet-saved) wizard session.
 *  This is transient UI-only state — it's never persisted anywhere until the
 *  first successful autosave assigns a real database loanId. */
export function createDraftId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `d_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/** Active drafts for the current user, newest-touched first — read live from the database. */
export async function listDraftMetas(): Promise<WizardDraftSummary[]> {
  try {
    const res = await wizardApi.listDrafts()
    return res.data.data ?? []
  } catch {
    return []
  }
}

/** Discards a draft permanently — soft-deletes the underlying Draft loan server-side. */
export async function deleteDraftMeta(loanId: number): Promise<void> {
  try {
    const { loansApi } = await import('@/api/loansApi')
    await loansApi.delete(loanId)
  } catch {
    // Best-effort — if this fails the draft simply stays in the list and
    // the person can retry; nothing is silently lost either way since the
    // database record is the only copy that ever existed.
  }
}
