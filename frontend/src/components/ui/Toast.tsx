import { useToastStore, type ToastType } from '@/store/toastStore'
import { cn } from '@/utils/format'

/**
 * Toast host — renders the stack that legacy kept in `#toast-container`.
 *
 * Mounted once at the app root so any screen (including Login, which sits
 * outside AppLayout) can raise one. Styling lives in globals.css as
 * `.efin-toast*`, ported from legacy `.toast-container` / `.toast`.
 */

/** efin-app.js:15292 — the exact icon set legacy used. */
const ICONS: Record<ToastType, string> = {
  success: '✅',
  error: '❌',
  warn: '⚠️',
  info: 'ℹ️',
}

export function ToastHost() {
  const toasts = useToastStore(s => s.toasts)
  const dismiss = useToastStore(s => s.dismiss)

  if (!toasts.length) return null

  return (
    // aria-live so screen readers announce toasts; legacy had no equivalent,
    // and this costs nothing visually.
    <div className="efin-toast-container" role="status" aria-live="polite">
      {toasts.map(t => (
        <div
          key={t.id}
          className={cn('efin-toast', `efin-toast--${t.type}`, t.leaving && 'efin-toast--leaving')}
          // pointer-events are off on the container (legacy) so toasts never
          // block the page; re-enabled per toast for click-to-dismiss.
          style={{ pointerEvents: 'auto' }}
          onClick={() => dismiss(t.id)}
          title="Dismiss"
        >
          <span className="efin-toast__icon" aria-hidden="true">{ICONS[t.type]}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}

export default ToastHost
