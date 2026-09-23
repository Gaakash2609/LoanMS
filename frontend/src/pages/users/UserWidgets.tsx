// Users page presentational widgets — extracted verbatim from UsersPage.tsx
// (code-quality refactor, no behaviour change).

import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Eye, KeyRound, MapPin, Pencil, Trash2, UserCheck, UserX } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ROLE_COLORS, ROLE_LABELS } from '@/pages/users/userConstants'


export function RolePill({ role }: { role: string }) {
  const color = ROLE_COLORS[role] ?? '#8a96b4'
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset ring-black/5"
      style={{ letterSpacing: '.3px', background: `${color}1f`, color }}>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      {ROLE_LABELS[role] ?? role}
    </span>
  )
}

// Row "Actions ▾" dropdown — legacy renders each user row's actions as a single
// menu button (efin-app.js:24931), not a strip of icon buttons. Only actions
// this app's backend actually supports are shown: legacy's "Suspend" is a third
// user state that LoanMS's UserDto (active/inactive only) does not have, so it
// is intentionally omitted rather than shown as a no-op.
export function UserActionsMenu({ isActive, onView, onEdit, onMap, onToggle, onReset, onDelete }: {
  isActive: boolean
  onView: () => void; onEdit: () => void; onMap: () => void
  onToggle: () => void; onReset: () => void; onDelete?: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const item = 'w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left hover:bg-gray-50 transition-colors'
  return (
    <div ref={ref} className="relative inline-block text-left">
      <Button variant="secondary" size="sm" onClick={() => setOpen(o => !o)}>
        Actions <ChevronDown size={13} className="ml-1" />
      </Button>
      {open && (
        <div className="absolute right-0 top-9 z-[var(--z-dropdown)] w-56 bg-white border border-gray-200 rounded-xl py-1.5"
          style={{ boxShadow: '0 12px 40px rgba(8,88,151,.14)' }}>
          <button className={item} onClick={() => { setOpen(false); onView() }}><Eye size={14} className="text-gray-500" /> View Details</button>
          <button className={item} onClick={() => { setOpen(false); onEdit() }}><Pencil size={14} className="text-orange-500" /> Edit User</button>
          <button className={item} onClick={() => { setOpen(false); onMap() }}><MapPin size={14} className="text-pink-500" /> Manage Locations &amp; Teams</button>
          <button className={item} style={{ color: 'var(--warn)' }} onClick={() => { setOpen(false); onToggle() }}>
            {isActive ? <UserX size={14} /> : <UserCheck size={14} />} {isActive ? 'Deactivate' : 'Activate'}
          </button>
          <button className={item} onClick={() => { setOpen(false); onReset() }}><KeyRound size={14} className="text-amber-500" /> Reset Password</button>
          {onDelete && (
            <button className={item} style={{ color: 'var(--danger)' }} onClick={() => { setOpen(false); onDelete() }}>
              <Trash2 size={14} /> Delete User
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// A single coloured pill for the Users table's Locations / Sales-Team /
// Operation-Team columns — legacy twPillCell rendering a user's primary value
// (efin-app.js:24915-24917). Renders an em-dash when unset.
export function UserPill({ value, color, bg, prefix = '' }: { value?: string | null; color: string; bg: string; prefix?: string }) {
  if (!value) return <span className="text-gray-300">—</span>
  return (
    <span className="inline-block px-[7px] py-[2px] rounded-full text-[10.5px] font-medium whitespace-nowrap" style={{ background: bg, color }}>
      {prefix}{value}
    </span>
  )
}
