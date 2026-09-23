import React from 'react'
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/utils/format'

// ── Empty / Error states ────────────────────────────────────────────────
// Every list screen needs three distinct answers to "why is nothing here?":
// still loading (Skeleton), nothing exists yet (EmptyState), or the request
// failed (ErrorState). Collapsing the last two into one grey "No records
// found" hides real outages — a 500 looked exactly like an empty table.

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ElementType
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center px-5 py-[60px]', className)}>
      <div className="w-12 h-12 rounded-full bg-[color:var(--surface2)] flex items-center justify-center mb-3">
        <Icon size={22} className="text-[color:var(--text3)]" />
      </div>
      <p className="text-sm font-semibold text-[color:var(--text)]">{title}</p>
      {description && (
        <p className="text-xs text-[color:var(--text3)] mt-1 max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/**
 * Pulls a human message out of an axios error. Falls back to the caller's
 * wording rather than leaking "Request failed with status code 500".
 */
export function errorText(err: unknown, fallback = 'Something went wrong.'): string {
  const res = (err as { response?: { status?: number; data?: { message?: string; errors?: string[] } } })?.response
  const data = res?.data
  const fromBody = data?.message || data?.errors?.join(' ')
  if (fromBody) return fromBody
  if (res?.status === 403) return "You don't have permission to view this."
  if (res?.status === 404) return 'This item no longer exists.'
  if (res?.status === 401) return 'Your session has expired. Please sign in again.'
  if ((err as { code?: string })?.code === 'ERR_NETWORK') return 'Could not reach the server. Check your connection.'
  return fallback
}

export function ErrorState({
  error,
  fallback,
  onRetry,
  className,
}: {
  error?: unknown
  fallback?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center px-5 py-[60px]', className)} role="alert">
      {/* Legacy's error surface (app.css:8591 `.err` / :8610 `.kyc-badge-err`)
          is rgba(192,57,43,.1) over --danger text -- a different red family
          from Tailwind's stock red-50/500/600, and the one thing in this
          file that was never actually mapped to a legacy value. */}
      <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: 'rgba(192, 57, 43, .1)' }}>
        <AlertTriangle size={22} style={{ color: 'var(--danger)' }} />
      </div>
      <p className="text-sm font-semibold text-[color:var(--text)]">Couldn't load this</p>
      <p className="text-xs mt-1 max-w-sm" style={{ color: 'var(--danger)' }}>{errorText(error, fallback)}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-4" onClick={onRetry}>
          <RefreshCw size={13} className="mr-1.5" />Try again
        </Button>
      )}
    </div>
  )
}

/** Inline banner for a failed *action* (save/delete), not a failed load. */
export function ErrorBanner({ error, fallback, className }: { error?: unknown; fallback?: string; className?: string }) {
  if (error == null) return null
  return (
    <div
      role="alert"
      className={cn('text-sm rounded-lg px-3 py-2', className)}
      style={{ color: 'var(--danger)', background: 'rgba(192, 57, 43, .1)', border: '1px solid rgba(192, 57, 43, .25)' }}
    >
      {errorText(error, fallback)}
    </div>
  )
}
