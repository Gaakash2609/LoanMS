import { create } from 'zustand'

/**
 * Toast store — the React-owned replacement for legacy's global
 * `showToast(msg, type)` (efin-app.js:15291), which created a DOM node by hand
 * and appended it to `#toast-container`.
 *
 * Behaviour is matched to legacy rather than reinvented:
 *   • four types: success / error / warn / info, each with legacy's icon
 *   • auto-dismiss after 3200ms
 *   • a 350ms exit animation before the node is removed
 *
 * Legacy allowed unlimited stacking; a burst of API failures could bury the
 * screen. MAX_VISIBLE trims the oldest beyond a sane cap, which is the one
 * deliberate improvement — noted so it isn't mistaken for a parity miss.
 */
export type ToastType = 'success' | 'error' | 'warn' | 'info'

export interface Toast {
  id: number
  message: string
  type: ToastType
  /** True once the exit animation has started; the host keeps it mounted for LEAVE_MS. */
  leaving?: boolean
}

/** efin-app.js:15301 — setTimeout(..., 3200) before the exit begins. */
export const DISMISS_MS = 3200
/** efin-app.js:15300 — setTimeout(() => t.remove(), 350) after `toast-leaving`. */
export const LEAVE_MS = 350

const MAX_VISIBLE = 4

interface ToastState {
  toasts: Toast[]
  show: (message: string, type?: ToastType) => number
  dismiss: (id: number) => void
  remove: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  show: (message, type = 'info') => {
    const id = nextId++
    set(s => {
      // Collapse an identical message that is still on screen instead of
      // stacking duplicates — rapid retries otherwise emit the same line N times.
      const dup = s.toasts.find(t => t.message === message && t.type === type && !t.leaving)
      if (dup) return s
      const next = [...s.toasts, { id, message, type }]
      return { toasts: next.slice(-MAX_VISIBLE) }
    })

    window.setTimeout(() => get().dismiss(id), DISMISS_MS)
    return id
  },

  // Starts the exit animation, then unmounts once it has played.
  dismiss: id => {
    const exists = get().toasts.some(t => t.id === id && !t.leaving)
    if (!exists) return
    set(s => ({ toasts: s.toasts.map(t => (t.id === id ? { ...t, leaving: true } : t)) }))
    window.setTimeout(() => get().remove(id), LEAVE_MS)
  },

  remove: id => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))

/**
 * Convenience hook mirroring legacy's call shape:
 *   toast.success('Saved')   ~  showToast('Saved', 'success')
 */
export function useToast() {
  const show = useToastStore(s => s.show)
  return {
    show,
    success: (m: string) => show(m, 'success'),
    error: (m: string) => show(m, 'error'),
    warn: (m: string) => show(m, 'warn'),
    info: (m: string) => show(m, 'info'),
  }
}
