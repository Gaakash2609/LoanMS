// Locations page types + presentational helper — extracted verbatim from
// LocationsPage.tsx (code-quality refactor, no behaviour change).

export interface Location {
  id: number; name: string; city: string; state: string; pinCode?: string; isActive: boolean
  salesTeams?: string[]; loginTeams?: string[]; users?: string[]
}

export const EMPTY_FORM = { name: '', city: '', state: '', pinCode: '' }

/** Vanilla's twPillCell (efin-app.js:24847) — shows the first 2 names as
 * pills, with a "+N" badge (hover title lists the rest) for anything past
 * that, and an em-dash when the list is empty. */
export function PillCell({ items, bg, color }: { items: string[]; bg: string; color: string }) {
  if (!items.length) return <span className="text-gray-300">—</span>
  const shown = items.slice(0, 2)
  const extra = items.length - shown.length
  return (
    <div className="flex flex-wrap gap-1 max-w-[150px]">
      {shown.map(n => (
        <span key={n} className="text-[10px] rounded-full px-1.5 py-0.5 whitespace-nowrap"
          style={{ background: bg, color }}>{n}</span>
      ))}
      {extra > 0 && (
        <span title={items.slice(2).join(', ')}
          className="text-[10px] rounded-full px-1.5 py-0.5 bg-gray-100 text-gray-500 border border-gray-200 whitespace-nowrap">
          +{extra}
        </span>
      )}
    </div>
  )
}
