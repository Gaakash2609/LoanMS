import React from 'react'
import { cn } from '@/utils/format'

// ── Tabs ────────────────────────────────────────────────────────────────
// The same underline-tab bar was written by hand on Settings, Payout, Loan
// Detail, Reports and CIBIL, each with its own colours and spacing. This is
// that pattern, once — including the two things the copies kept missing:
// horizontal scroll instead of wrapping on narrow screens, and real
// role="tab" semantics so arrow keys and screen readers work.

export interface TabItem<T extends string = string> {
  key: T
  label: React.ReactNode
  /** Small count/badge shown after the label. */
  count?: number
  icon?: React.ElementType
  /** Hide a tab the current role can't use, without reshuffling callers. */
  hidden?: boolean
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: TabItem<T>[]
  active: T
  onChange: (key: T) => void
  className?: string
}) {
  const visible = tabs.filter(t => !t.hidden)

  // ← / → move between tabs, matching the WAI-ARIA tabs pattern.
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const i = visible.findIndex(t => t.key === active)
    if (i === -1) return
    const next = e.key === 'ArrowRight'
      ? visible[(i + 1) % visible.length]
      : visible[(i - 1 + visible.length) % visible.length]
    onChange(next.key)
  }

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      // overflow-x-auto (not wrap) keeps the bar one line high on phones —
      // a wrapped tab bar pushes page content around as tabs change.
      className={cn('flex items-center gap-6 border-b border-token overflow-x-auto', className)}
    >
      {visible.map(({ key, label, count, icon: Icon }) => {
        const isActive = key === active
        return (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(key)}
            className={cn(
              'shrink-0 whitespace-nowrap pb-3 px-1 -mb-px border-b-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-efin-blue text-efin-blue'
                : 'border-transparent text-[color:var(--text2)] hover:text-[color:var(--text)]'
            )}
          >
            <span className="flex items-center gap-2">
              {Icon && <Icon size={15} />}
              {label}
              {count != null && (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[11px] font-semibold',
                    isActive ? 'bg-[color:var(--accent-subtle)] text-efin-blue' : 'bg-[color:var(--surface3)] text-[color:var(--text3)]'
                  )}
                >
                  {count}
                </span>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default Tabs
