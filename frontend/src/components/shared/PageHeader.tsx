import type { ReactNode } from 'react'

interface Props {
  title: ReactNode
  subtitle?: string
  action?: ReactNode
}

// Faithful to Vanilla's page-header pattern (e.g. index.html:4391 Reports):
// a flex row with a var(--font-head) 24px/800 title in --text and a 13px
// --text3 subtitle — not Tailwind gray. Right-aligned actions unchanged.
export default function PageHeader({ title, subtitle, action }: Props) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
      <div className="min-w-0">
        <h1
          className="flex items-center gap-2 break-words"
          style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 800, letterSpacing: '-.3px', color: 'var(--text)' }}
        >
          {title}
        </h1>
        {subtitle && <p className="mt-1" style={{ fontSize: 13, color: 'var(--text3)' }}>{subtitle}</p>}
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </div>
  )
}
