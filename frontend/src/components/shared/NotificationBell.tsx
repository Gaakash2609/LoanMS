import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Clock, CheckCheck } from 'lucide-react'
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
  const unreadCount = notifications.filter(n => !n.isRead).length
  const visible = notifications.slice(0, 10)

  // Rings the bell once when unread notifications first appear (e.g. the
  // initial fetch lands with unread items), not on every render.
  const [ring, setRing] = useState(false)
  const prevHasUnread = useRef(false)
  useEffect(() => {
    const justBecameUnread = hasUnread && !prevHasUnread.current
    prevHasUnread.current = hasUnread
    if (!justBecameUnread) return
    setRing(true)
    const t = setTimeout(() => setRing(false), 500)
    return () => clearTimeout(t)
  }, [hasUnread])

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
        aria-label={hasUnread ? 'Notifications (unread)' : 'Notifications'}
        className="efin-topbar-icon-btn relative"
      >
        <Bell size={18} className={ring ? 'notif-bell-ring' : undefined} />
        {hasUnread && <span className="efin-topbar-notif-dot" />}
      </button>

      {open && (
        <div ref={panelRef}
          className="notif-panel-enter absolute top-11 right-0 w-[22rem] max-h-[440px] overflow-y-auto rounded-2xl z-50"
          style={{ background: 'var(--surface)', border: '1.5px solid var(--border)', boxShadow: '0 24px 64px rgba(12,23,61,.22)' }}>
          <div className="notif-panel-head sticky top-0 z-10">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ fontFamily: 'var(--font-head)', color: 'var(--text)' }}>Notifications</span>
              {unreadCount > 0 && <span className="notif-count-badge">{unreadCount}</span>}
            </div>
            <button
              onClick={() => markReadLocally(notifications.filter(n => !n.isRead).map(n => n.id))}
              className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--accent)' }}
            >
              <CheckCheck size={13} /> Mark all read
            </button>
          </div>
          {visible.length === 0 ? (
            <div className="text-center py-10">
              <div className="empty-illustration mx-auto mb-3"><Bell size={26} className="empty-illustration-icon" /></div>
              <p className="text-[13px] font-semibold" style={{ color: 'var(--text)' }}>You're all caught up</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>No notifications right now</p>
            </div>
          ) : (
            visible.map(n => (
              <div
                key={n.id}
                onClick={() => markReadLocally([n.id])}
                className={`notif-item ${n.isRead ? '' : 'is-unread'}`}
              >
                <span className="notif-icon-tile">{n.icon || '🔔'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs leading-snug" style={{ color: n.isRead ? 'var(--text3)' : 'var(--text)', fontWeight: n.isRead ? 400 : 600 }}>
                    {n.message || n.type}
                  </p>
                  <p className="text-[11px] mt-1 flex items-center gap-1" style={{ color: 'var(--text3)' }}>
                    <Clock size={10} /> {timeAgo(n.createdAt)}
                    {!n.isRead && <span className="ml-1 font-bold" style={{ color: 'var(--accent)' }}>· New</span>}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
