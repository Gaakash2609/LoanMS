import { settingsApi } from './settingsApi'
import {
  MASTER_LISTS_SETTING_KEY, MASTER_LISTS_SETTING_CATEGORY,
  MASTER_LIST_DEFS, type MasterListItem,
} from '@/constants/masterLists'

// ── Loan Form Dropdown Lists ────────────────────────────────────────────
// Legacy stores the whole map as one JSON blob in AppSettings under
// "efin_master_lists" (stgMlPushToServer, efin-app.js:37042) rather than in a
// table of its own. That is reused as-is here — a schema change for five
// dropdown lists would not earn its keep.
//
// Because it is one blob, every save writes the complete map. Sending only
// the edited list would drop the other four, so callers must pass the whole
// thing (buildSaveMap below does that).
//
// settingsApi.update() must be given the category back or the upsert nulls
// it — see its own doc comment.

/** The stored shape: list key → its items. */
export type MasterListMap = Record<string, MasterListItem[]>

export const masterListsApi = {
  get: () => settingsApi.getByKey(MASTER_LISTS_SETTING_KEY),

  save: (map: MasterListMap) =>
    settingsApi.update(
      MASTER_LISTS_SETTING_KEY,
      JSON.stringify(map),
      MASTER_LISTS_SETTING_CATEGORY,
    ),
}

/**
 * Reads the stored blob into a map, falling back to each list's built-in
 * defaults. Legacy's stored value is the full MASTER_LISTS object (definition
 * fields and all), so items are picked out of whichever shape is present.
 * A corrupt value must not blank the editor — it falls back to defaults.
 */
export function parseStoredMap(raw?: string | null): MasterListMap {
  const out: MasterListMap = {}
  let parsed: Record<string, unknown> | null = null
  if (raw) {
    try {
      const p = JSON.parse(raw)
      if (p && typeof p === 'object' && !Array.isArray(p)) parsed = p as Record<string, unknown>
    } catch { /* fall through to defaults */ }
  }

  for (const def of MASTER_LIST_DEFS) {
    const stored = parsed?.[def.key]
    // Accept both shapes: a bare array of items, or legacy's { items: [...] }.
    const items = Array.isArray(stored)
      ? stored
      : (stored as { items?: unknown })?.items

    out[def.key] = Array.isArray(items)
      ? (items as unknown[])
          .map(normaliseItem)
          .filter((i): i is MasterListItem => i !== null)
      : def.defaults.map(i => ({ ...i }))
  }
  return out
}

/** Tolerates plain strings as well as { value, label } objects. */
function normaliseItem(raw: unknown): MasterListItem | null {
  if (typeof raw === 'string') {
    const v = raw.trim()
    return v ? { value: v, label: v } : null
  }
  if (raw && typeof raw === 'object') {
    const o = raw as { value?: unknown; label?: unknown }
    const value = typeof o.value === 'string' ? o.value.trim() : ''
    const label = typeof o.label === 'string' ? o.label.trim() : value
    if (value) return { value, label: label || value }
  }
  return null
}

/**
 * The map to POST. Lists owned by another screen are always written back
 * empty, exactly as legacy leaves them — this editor must never become a
 * second place those records can be created.
 */
export function buildSaveMap(current: MasterListMap): MasterListMap {
  const out: MasterListMap = {}
  for (const def of MASTER_LIST_DEFS) {
    out[def.key] = def.sourcedElsewhere ? [] : (current[def.key] ?? [])
  }
  return out
}
