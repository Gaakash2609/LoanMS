import type { ReactNode } from 'react'

/**
 * Sub-tab row used inside the loan detail page (Lender Details → Bank/InCred,
 * Reports → Perfios/CIBIL, Perfios result tabs). Matches the target design:
 * 14px labels, active = semibold #1a4fa3 with a 2px underline that sits ABOVE
 * a full-width 2px #dde3f0 divider (not overlapping it); inactive = medium
 * #7a8aaa with a transparent underline so nothing shifts on switch.
 * An optional emoji keeps its own colour in both states.
 */
export interface SubTabItem<K extends string = string> {
  key: K
  label: ReactNode
  emoji?: string
}

interface Props<K extends string> {
  tabs: SubTabItem<K>[]
  active: string | undefined
  onChange: (key: K) => void
  className?: string
}

export function SubTabBar<K extends string>({ tabs, active, onChange, className = 'mb-5' }: Props<K>) {
  return (
    <div
      role="tablist"
      className={`flex items-stretch gap-1 overflow-x-auto border-b-2 ${className}`}
      style={{ borderColor: 'var(--border, #dde3f0)' }}
    >
      {tabs.map(t => {
        const on = active === t.key
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 px-6 pb-3 pt-2 text-sm border-b-2 transition-colors ${
              on ? 'font-semibold' : 'font-medium hover:!text-[#4a6299]'
            }`}
            style={{
              color: on ? 'var(--accent, #085897)' : 'var(--text3, #7a8aaa)',
              borderBottomColor: on ? 'var(--accent, #085897)' : 'transparent',
            }}
          >
            {t.emoji && <span>{t.emoji}</span>}
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
