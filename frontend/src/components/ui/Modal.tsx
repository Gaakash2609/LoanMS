import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/utils/format'

// ── Modal ───────────────────────────────────────────────────────────────
// Replaces the hand-rolled `fixed inset-0 bg-black/40 …` block that had been
// copy-pasted into a dozen components, each with a slightly different set of
// missing behaviours. Centralising it means every dialog now gets:
//   · Esc to close
//   · click-outside to close (without the "click inside also closes it" bug
//     that the copies kept re-introducing — see the stopPropagation wrapper)
//   · background scroll lock while open
//   · focus moved into the dialog, and restored to the trigger on close
//   · role="dialog" + aria-modal + a labelled title
//   · a body that scrolls on short screens instead of overflowing the viewport
//
// Responsive: full-width with generous padding on phones, capped by `size`
// from `sm:` up. The panel never exceeds 90vh, so the footer stays reachable.

const SIZES = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
} as const

export interface ModalProps {
  open?: boolean
  onClose: () => void
  title?: React.ReactNode
  /** Small muted line under the title. */
  subtitle?: React.ReactNode
  size?: keyof typeof SIZES
  /** Sticky action bar pinned to the bottom of the panel. */
  footer?: React.ReactNode
  /** Set false for destructive flows that must not close by accident. */
  dismissable?: boolean
  children: React.ReactNode
  className?: string
  /** Extra classes for the header row -- e.g. a custom background, for the
   *  rare modal whose title needs more than plain text. */
  headerClassName?: string
}

export function Modal({
  open = true,
  onClose,
  title,
  subtitle,
  size = 'md',
  footer,
  dismissable = true,
  children,
  className,
  headerClassName,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Esc to close + restore focus to whatever opened the dialog.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) onClose()
    }
    document.addEventListener('keydown', onKeyDown)

    // Move focus into the panel so keyboard users aren't left behind the
    // overlay. Prefer the first focusable control, else the panel itself.
    const focusable = panelRef.current?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )
    ;(focusable ?? panelRef.current)?.focus()

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [open, dismissable, onClose])

  // Lock background scroll. Restores the caller's own overflow value rather
  // than assuming it was '' — nested modals would otherwise unlock early.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  if (!open) return null

  const labelId = title ? 'modal-title' : undefined

  return (
    <div
      // z-index must come from the shared scale (globals.css --z-*), not an
      // arbitrary Tailwind step. The old `z-50` sat BELOW the topbar
      // (--z-topbar: 100), so the topbar bled through the dimmed overlay.
      // --z-modal (9998) is the top of the stack, above topbar and sidebar.
      className="efin-modal-overlay fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4"
      onClick={() => { if (dismissable) onClose() }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelId}
        // The overlay's onClick fires for clicks that bubble out of the panel
        // too, which is what made earlier copies close while you were typing.
        onClick={e => e.stopPropagation()}
        className={cn(
          'efin-modal-panel w-full bg-surface rounded-token shadow-lg border border-token',
          'flex flex-col max-h-[90vh] outline-none',
          SIZES[size],
          className
        )}
      >
        {(title || dismissable) && (
          <div className={cn('flex items-start justify-between gap-3 px-5 py-4 border-b border-token shrink-0', headerClassName)}>
            <div className="min-w-0">
              {title && (
                <h3 id={labelId} className="text-sm font-semibold text-[color:var(--text)] truncate">
                  {title}
                </h3>
              )}
              {subtitle && <p className="text-xs text-[color:var(--text3)] mt-0.5">{subtitle}</p>}
            </div>
            {dismissable && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="shrink-0 -mr-1 -mt-1 p-1 rounded-lg text-[color:var(--text3)] hover:text-[color:var(--text)] hover:bg-[color:var(--accent-subtle)] transition-colors"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}

        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t border-token shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export default Modal
