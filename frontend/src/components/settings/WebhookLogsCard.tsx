import { useState } from 'react'
import { SkeletonText } from '@/components/ui/Skeleton'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { webhookLogsApi, type WebhookLogEntry } from '@/api/webhookLogsApi'

// ── Webhook Logs ────────────────────────────────────────────────────────
// Ports legacy's Settings "Folder 13 — Webhook Logs" (index.html) and
// stgRenderWebhookLogs / stgRefreshWebhooks (efin-app.js:37114, 37173).
//
// Kept from legacy: the collapsible folder with the same title and sub-line,
// the Refresh action, the monospace event cards, the 200/404 badge driven by
// `ok`, and the four labelled fields (APP_ID / REF / EVENT / STATUS).
//
// Not carried over, deliberately:
//   • Legacy's fallback to `twWebhookLogs`, a client-side array filled by a
//     "Simulate" button. Showing simulated events beside real callbacks in a
//     diagnostic log is misleading — an empty list here means no webhook has
//     actually arrived.
//   • Legacy's side effect of writing incred_last_webhook_event/status back
//     onto its local APPLICATIONS array. The server already persists that on
//     the Loan row when it processes the callback; re-deriving it in the
//     browser would just risk disagreeing with it.

function LogRow({ log }: { log: WebhookLogEntry }) {
  return (
    <div className="rounded-[10px] border border-token bg-surface2 px-4 py-3 mb-2 font-mono text-[12.5px]">
      <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
        <span className="text-[10.5px]" style={{ color: 'var(--text3)' }}>⏱ {log.time || '—'}</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
          log.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }`}>
          {log.ok ? '✓ 200 OK' : '✗ 404 Not Found'}
        </span>
      </div>
      <div className="flex flex-wrap gap-4">
        <span><span style={{ color: 'var(--text3)' }}>APP_ID </span><span className="text-red-600">"{log.appId ?? ''}"</span></span>
        <span><span style={{ color: 'var(--text3)' }}>REF </span><span className="text-red-600">"{log.ref ?? ''}"</span></span>
        <span><span style={{ color: 'var(--text3)' }}>EVENT </span><span className="text-amber-600">"{log.event ?? ''}"</span></span>
        <span><span style={{ color: 'var(--text3)' }}>STATUS </span><span className={log.ok ? 'text-green-700' : 'text-red-600'}>"{log.status ?? ''}"</span></span>
      </div>
    </div>
  )
}

export default function WebhookLogsCard() {
  const [open, setOpen] = useState(false)

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    // No .data.data here — this endpoint returns a raw { logs } object.
    queryKey: ['webhook-logs'],
    queryFn: () => webhookLogsApi.getAll().then(r => r.data?.logs ?? []),
    enabled: open,
    staleTime: 30_000,
    retry: false,
  })

  const logs = data ?? []

  return (
    <Card padding={false}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        <span
          className="w-9 h-9 rounded-[9px] flex items-center justify-center text-white text-[15px] shrink-0"
          style={{ background: 'linear-gradient(135deg,#7c3aed,#a78bfa)' }}>
          🔗
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-base font-semibold" style={{ color: 'var(--text)' }}>Webhook Logs</span>
          <span className="block text-sm mt-0.5" style={{ color: 'var(--text3)' }}>
            Recent InCred integration webhook events · POST /incred/loan/webhook
          </span>
        </span>
        {open && logs.length > 0 && (
          <span className="text-xs font-semibold" style={{ color: 'var(--text3)' }}>
            {logs.length} event{logs.length === 1 ? '' : 's'}
          </span>
        )}
        <ChevronDown size={16} style={{ color: 'var(--text3)', transition: 'transform .2s', transform: open ? 'rotate(180deg)' : undefined }} />
      </button>

      {open && (
        <div className="px-5 pb-5">
          <div className="flex justify-end mb-3">
            <Button size="sm" variant="secondary"
              loading={isFetching} disabled={isFetching}
              onClick={() => refetch()}>
              <RefreshCw size={14} className="mr-1" />Refresh
            </Button>
          </div>

          {error != null ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              Could not load webhook logs.
              <button onClick={() => refetch()} className="ml-2 font-semibold underline">Try again</button>
            </div>
          ) : isLoading ? (
            <SkeletonText lines={4} className="py-4" />
          ) : logs.length === 0 ? (
            <div className="py-8 text-center text-[13px]" style={{ color: 'var(--text3)' }}>
              <div className="text-2xl mb-2">📭</div>
              No webhook events received yet.
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              {logs.map((log, i) => <LogRow key={`${log.time}-${log.appId}-${i}`} log={log} />)}
              {logs.length >= 100 && (
                <p className="text-[11px] mt-1" style={{ color: 'var(--text3)' }}>
                  Showing the 100 most recent events — older ones are not retained.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
