export interface DetailTabItem<K extends string = string> {
  key: K
  label: string
  emoji: string
}

/**
 * Top tab strip of the loan detail page. Light-blue gradient bar; the active
 * tab is a white pill (rounded top corners only) with a light-blue border and
 * a 3px square #1a4fa3 underline. Tabs wrap onto a second row instead of
 * scrolling. Colours use the design tokens from globals.css (with their
 * literal values as fallbacks).
 */
export function DetailTabBar<K extends string>({
  tabs, active, onChange,
}: { tabs: DetailTabItem<K>[]; active: string | undefined; onChange: (key: K) => void }) {
  return (
    <div
      role="tablist"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-t-xl border border-b-0 px-3.5 pt-[9px] pb-0"
      style={{ background: 'linear-gradient(180deg, var(--surface2, #f0f4ff) 0%, #ecf2fd 100%)', borderColor: '#e0e8f8' }}
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
            className={`shrink-0 inline-flex items-center gap-[6.5px] px-4 py-[7px] text-sm rounded-t-[10px] border border-b-[3px] transition-colors ${
              on ? 'bg-white font-semibold' : 'border-transparent font-medium hover:bg-white/60'
            }`}
            style={{
              color: on ? 'var(--accent, #085897)' : '#4a6299',
              borderColor: on ? '#c8d8f8' : undefined,
              borderBottomColor: on ? 'var(--accent, #085897)' : 'transparent',
              boxShadow: on ? '0 2px 8px rgba(8,88,151,.10)' : undefined,
            }}
          >
            <span>{t.emoji}</span>{t.label}
          </button>
        )
      })}
    </div>
  )
}
