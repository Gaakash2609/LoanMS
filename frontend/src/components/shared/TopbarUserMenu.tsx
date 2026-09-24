import { useState, useRef, useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { User as UserIcon, Lock, LogOut } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useLogout } from '@/hooks/useAuth'

// Vanilla's topbar profile dropdown (index.html:617 #topbar-profile-btn /
// #topbar-profile-dropdown): a red (accent2) avatar button that opens a
// 230px menu with the user info header, My Profile, Change Password, Logout
// and a version line. Reuses the existing useLogout()/authStore — no new
// auth logic. Opens/closes on click, closes on outside-click and Escape,
// exactly like Vanilla's toggleTopbarProfileDropdown() + its document
// listener.
function getInitials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function MenuRow({ icon, label, onClick, danger }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[9px] text-[13px] font-medium transition-colors text-left"
      style={{ color: 'var(--text2)' }}
      onMouseOver={e => { e.currentTarget.style.background = danger ? 'rgba(227,30,37,.07)' : 'var(--accent-subtle)'; e.currentTarget.style.color = danger ? 'var(--accent2)' : 'var(--accent)' }}
      onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text2)' }}
    >
      {icon}{label}
    </button>
  )
}

export default function TopbarUserMenu() {
  const user = useAuthStore(s => s.user)
  const logout = useLogout()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const go = (path: string) => { setOpen(false); navigate(path) }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        title="My Profile"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-[38px] h-[38px] rounded-full text-white items-center justify-center font-extrabold"
        style={{ background: 'var(--accent2)', fontFamily: 'var(--font-head)', fontSize: 14, letterSpacing: '.5px', boxShadow: '0 2px 10px rgba(227,30,37,.3)' }}
      >
        {getInitials(user?.fullName)}
      </button>

      {open && (
        <div role="menu" className="lms-menu-in absolute right-0 top-[calc(100%+10px)] p-2.5"
          style={{ minWidth: 230, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, boxShadow: '0 12px 48px rgba(10,88,154,.16)', zIndex: 300 }}>
          <div className="flex items-center gap-3 px-3 pt-2.5 pb-3">
            <div className="w-[38px] h-[38px] rounded-full flex items-center justify-center text-white font-extrabold shrink-0"
              style={{ background: 'var(--accent2)', fontFamily: 'var(--font-head)', fontSize: 13 }}>
              {getInitials(user?.fullName)}
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-bold truncate" style={{ color: 'var(--text)' }}>{user?.fullName ?? 'User'}</div>
              <div className="text-xs truncate" style={{ color: 'var(--accent2)' }}>{user?.email ?? '—'}</div>
            </div>
          </div>
          <div className="mx-1 mb-1.5" style={{ height: 1, background: 'var(--border)' }} />
          <MenuRow icon={<UserIcon size={15} />} label="My Profile" onClick={() => go('/profile')} />
          {/* Vanilla's openChangePassword() opens the change-password flow;
              React's Change Password lives on the Profile page, so this routes
              there (reuse — no duplicate password UI). */}
          <MenuRow icon={<Lock size={15} />} label="Change Password" onClick={() => go('/profile')} />
          <div className="mx-1 my-1.5" style={{ height: 1, background: 'var(--border)' }} />
          <MenuRow icon={<LogOut size={15} />} label="Logout" danger onClick={() => { setOpen(false); logout.mutate() }} />
          <div className="text-center text-[11px] pt-2 pb-0.5" style={{ color: 'var(--text3)', letterSpacing: '.3px' }}>V3.0</div>
        </div>
      )}
    </div>
  )
}
