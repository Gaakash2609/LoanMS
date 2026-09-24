import React from 'react'
import { cn } from '@/utils/format'

interface CardProps { children: React.ReactNode; className?: string; padding?: boolean; hoverLift?: boolean }

// hoverLift is an opt-in extra (translate + a deliberately larger shadow on
// hover) that legacy never had anywhere on `.card`. It is not applied by
// default and no page currently passes hoverLift={true}, so it doesn't
// affect anything rendered today -- left as an available prop rather than
// removed since deleting an unused-but-harmless opt-in isn't this task's
// job, but flagged here: if a page starts using it, that's a deliberate
// departure from legacy, not a port.
export function Card({ children, className, padding = true, hoverLift = false }: CardProps) {
  return (
    <div
      className={cn(
        'efin-card',
        hoverLift && 'hover:-translate-y-0.5 hover:shadow-[0_16px_40px_-16px_rgba(10,88,154,.3)]',
        // legacy .card-body is 22px, not Tailwind's 24px p-6.
        padding && 'p-[22px]',
        className
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, action }: { title: React.ReactNode; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="efin-card-head flex items-center justify-between mb-4 -mx-[22px] -mt-[22px]">
      <div>
        <h3 className="efin-card-title text-[color:var(--text)] flex items-center gap-1.5">{title}</h3>
        {subtitle && <p className="text-sm text-[color:var(--text3)] mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
