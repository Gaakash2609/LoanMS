import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { notificationsApi, type AppNotification } from '@/api/notificationsApi'

// Matches legacy efin-app.js's timeAgo() in toggleNotifPanel() exactly.
function timeAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return 'Just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ── Topbar notification bell ────────────────────────────────────────────────
// Mirrors legacy efin-app.js's NOTIF_STORE/toggleNotifPanel/markNotifRead/
// markAllNotifsRead + api-bridge.js's sync patches: fetched once (no
// polling — legacy only re-syncs at boot and after pushNotif(), neither of
// which apply to a passive read-only bell), a dot (not a count) shows when
// any item is unread, and — matching legacy's exact behavior — opening the
// panel marks every currently-shown item as read immediately (not lazily
// per click), same as the original `NOTIF_STORE.forEach(n => n.read = true)`
// right after rendering.
export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => notificationsApi.getAll().then(r => r.data.data ?? []),
    staleTime: Infinity,
  })
  const notifications: AppNotification[] = data ?? []
  const hasUnread = notifications.some(n => !n.isRead)
  const visible = notifications.slice(0, 10)

  function markReadLocally(ids: number[]) {
    if (!ids.length) return
    qc.setQueryData<AppNotification[]>(['notifications'], (prev) =>
      (prev ?? []).map(n => ids.includes(n.id) ? { ...n, isRead: true } : n))
    ids.forEach(id => { notificationsApi.markRead(id).catch(() => {}) })
  }

  function togglePanel() {
    if (open) { setOpen(false); return }
    setOpen(true)
    const unreadIds = notifications.filter(n => !n.isRead).map(n => n.id)
    markReadLocally(unreadIds)
  }

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [open])

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); togglePanel() }}
        title="Notifications"
        className="relative w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"
      >
        <Bell size={18} />
        {hasUnread && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-efin-red" />
        )}
      </button>

      {open && (
        <div ref={panelRef}
          className="absolute top-11 right-0 w-80 max-h-[420px] overflow-y-auto bg-white border border-gray-200 rounded-2xl shadow-2xl z-50">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-200">
            <span className="text-sm font-bold text-gray-800">Notifications</span>
            <button
              onClick={() => markReadLocally(notifications.filter(n => !n.isRead).map(n => n.id))}
              className="text-xs font-semibold text-efin-blue"
            >
              Mark all read
            </button>
          </div>
          {visible.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-400">No notifications</div>
          ) : (
            visible.map(n => (
              <div
                key={n.id}
                onClick={() => markReadLocally([n.id])}
                className={`flex items-start gap-2.5 px-4 py-3 border-b border-gray-100 cursor-pointer ${n.isRead ? '' : 'bg-blue-50'}`}
              >
                <span className="text-lg shrink-0">{n.icon || '🔔'}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs leading-snug ${n.isRead ? 'text-gray-400' : 'text-gray-800 font-medium'}`}>
                    {n.message || n.type}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                </div>
                {!n.isRead && <div className="w-1.5 h-1.5 rounded-full bg-efin-blue shrink-0 mt-1" />}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
