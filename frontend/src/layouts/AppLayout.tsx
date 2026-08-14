import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useLogout } from '@/hooks/useAuth'
import { useLoanStore } from '@/store/loanStore'

import {
  LayoutDashboard, Users, CreditCard, Settings, LogOut, Menu, X,
  IndianRupee, BarChart3, CheckSquare, Ticket, UserCog, Building2,
  Calculator, FilePlus, MapPin, UserCircle, ClipboardList, Briefcase,
  CreditCard as BankIcon, Shield, Grid, Search, ExternalLink
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { UserRole } from '@/types'

// Turns "Admin General" -> "AG", "System" -> "SY", "" -> "?"
function getInitials(fullName?: string) {
  if (!fullName) return '?'
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// Tailwind's `lg` breakpoint (1024px). Below this we treat the sidebar as a
// mobile drawer (fixed + overlay + backdrop) instead of an inline flex column,
// so it can never squeeze/overlap page content.
const MOBILE_BREAKPOINT = 1024

type NavIcon = React.ElementType
interface NavItem { to: string; label: string; icon: NavIcon; roles?: UserRole[] }

const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard',      label: 'Dashboard',       icon: LayoutDashboard },
  { to: '/new-application',label: 'New Application', icon: FilePlus },
  { to: '/loans',          label: 'Loans',           icon: CreditCard },
  { to: '/customers',      label: 'Customers',       icon: Users },
  { to: '/calculator',     label: 'Calculator',      icon: Calculator },
  { to: '/cibil',          label: 'CIBIL Check',     icon: Search },
  { to: '/tasks',          label: 'Tasks',           icon: CheckSquare },
  { to: '/tickets',        label: 'Tickets',         icon: Ticket },
  { to: '/profile',        label: 'My Profile',      icon: UserCircle },
  // Manager+
  { to: '/payout',         label: 'Payout',          icon: IndianRupee,   roles: ['Admin','Manager','Accounts'] },
  { to: '/reports',        label: 'Reports',         icon: BarChart3,     roles: ['Admin','Manager'] },
  { to: '/teams',          label: 'Teams',           icon: Building2,     roles: ['Admin','Manager'] },
  { to: '/dsa',            label: 'DSA',             icon: Briefcase,     roles: ['Admin','Manager','Sales','ProductTeam'] },
  { to: '/locations',      label: 'Locations',       icon: MapPin,        roles: ['Admin','Manager'] },
  { to: '/banks',          label: 'Banks',           icon: BankIcon,      roles: ['Admin','Manager'] },
  { to: '/lender-config',  label: 'Lender Config',   icon: Grid,          roles: ['Admin','Manager','ProductTeam'] },
  { to: '/incred',         label: 'InCred',          icon: ExternalLink,  roles: ['Admin','Manager'] },
  // Admin only
  { to: '/users',          label: 'Users',           icon: UserCog,       roles: ['Admin'] },
  { to: '/security-roles', label: 'Security Roles',  icon: Shield,        roles: ['Admin'] },
  { to: '/policy-product', label: 'Policy Matrix',   icon: Grid,          roles: ['Admin'] },
  { to: '/audit',          label: 'Audit Log',       icon: ClipboardList, roles: ['Admin'] },
  { to: '/settings',       label: 'Settings',        icon: Settings,      roles: ['Admin'] },
]

function isMobileViewport() {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
}

export default function AppLayout() {
  const user     = useAuthStore(s => s.user)
  const logout   = useLogout()
  const location = useLocation()
  const navigate = useNavigate()
  const setLoanFilter = useLoanStore(s => s.setFilter)

  // Two independent concerns, deliberately kept separate:
  // - isMobile: which layout mode we're in (drawer vs inline column)
  // - open: whether the sidebar is visible right now
  const [isMobile, setIsMobile] = useState(isMobileViewport)
  const [open, setOpen] = useState(() => !isMobileViewport())

  // Header search. On >=sm it's an always-visible inline input; on mobile
  // it's collapsed behind a search icon (there's no room in a 320px header
  // for a logo + inline input + avatar) and expands into its own full-width
  // row that pushes content down, so it's never stacked on top of anything.
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const mobileSearchInputRef = useRef<HTMLInputElement>(null)

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setLoanFilter({ search: q })
    navigate('/loans')
    setSearchOpen(false)
  }

  useEffect(() => {
    if (searchOpen) mobileSearchInputRef.current?.focus()
  }, [searchOpen])

  // Close the mobile search row on navigation too, same reasoning as the drawer.
  useEffect(() => {
    setSearchOpen(false)
  }, [location.pathname])

  // Keep layout mode in sync with actual viewport width (covers device
  // rotation, browser resize, and dev-tools responsive mode) instead of
  // relying on a one-time check at mount.
  useEffect(() => {
    const handleResize = () => {
      const mobile = isMobileViewport()
      setIsMobile(prevMobile => {
        if (prevMobile === mobile) return prevMobile
        // Crossing the breakpoint: default to the sensible state for the
        // new mode (closed drawer on mobile, expanded column on desktop)
        // rather than carrying over whatever the other mode had.
        setOpen(!mobile)
        return mobile
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Close the mobile drawer automatically on every navigation so it never
  // stays open on top of the next page's content.
  useEffect(() => {
    if (isMobile) setOpen(false)
  }, [location.pathname, isMobile])

  const items = NAV_ITEMS.filter(i => !i.roles || (user?.role && i.roles.includes(user.role as UserRole)))

  const showLabels = isMobile ? true : open

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Backdrop: only rendered on mobile while the drawer is open, sits
          behind the sidebar and above page content, closes the drawer on tap. */}
      {isMobile && open && (
        <div
          className="fixed inset-0 z-30 bg-black/40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          bg-[#1e3a5f] flex flex-col overflow-hidden
          ${isMobile
            ? `fixed inset-y-0 left-0 z-40 w-64 transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'}`
            : `relative z-0 shrink-0 transition-all duration-200 ${open ? 'w-56' : 'w-14'}`
          }
        `}
      >
        <div className="flex items-center gap-3 p-4 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-sm">E</span>
          </div>
          {showLabels && <span className="text-white font-semibold text-sm truncate">EFIN LoanMS</span>}
          {isMobile && (
            <button
              onClick={() => setOpen(false)}
              className="ml-auto p-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          )}
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}>
              <Icon size={16} className="shrink-0" />
              {showLabels && <span className="truncate text-xs">{label}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          {showLabels && (
            <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
              <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                <span className="text-white text-xs font-medium">{user?.fullName?.[0]?.toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-medium truncate">{user?.fullName}</p>
                <p className="text-white/60 text-xs">{user?.role}</p>
              </div>
            </div>
          )}
          <button onClick={() => logout.mutate()}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-white/70 hover:bg-white/10 hover:text-white text-sm transition-colors">
            <LogOut size={16} className="shrink-0" />
            {showLabels && 'Logout'}
          </button>
        </div>
      </aside>

      {/* min-w-0 is essential here: without it, a flex child with wide text
          content refuses to shrink below its content width, which is what
          allowed the header/title to spill outside its box and overlap
          neighboring elements on narrow screens. */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* h-14 gives every child a fixed, known height to center against —
            that's what keeps the hamburger, brand text, search and avatar
            from ever climbing on top of one another at narrow widths.
            Every flex child below is explicitly shrink-0 except the brand
            label, which is the only one allowed to truncate. */}
        <header className="bg-white border-b border-gray-200 h-14 px-3 sm:px-4 flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            onClick={() => setOpen(!open)}
            className="w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500"
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>

          {/* Full brand line on tablet/desktop where there's room; a short
              form on mobile so it can't push the search/avatar off-screen. */}
          <span className="hidden sm:block text-sm text-gray-500 truncate min-w-0">
            EFIN Enterprise Loan Management
          </span>
          <span className="sm:hidden text-sm font-semibold text-gray-800 truncate min-w-0">
            EFIN LoanMS
          </span>

          {/* Inline search — tablet & desktop only, sits in normal flow so it
              can never overlap the hamburger or the title next to it. */}
          <form onSubmit={runSearch} className="hidden sm:flex flex-1 min-w-0 max-w-xs ml-auto relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search loans, customers..."
              aria-label="Search loans and customers"
              className="w-full rounded-lg border border-gray-300 bg-gray-50 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue focus:bg-white"
            />
          </form>

          {/* Mobile search trigger — replaces the inline input with an icon
              button so the header never has to squeeze five things into
              ~320px. Opens the row below instead of an overlay, so it pushes
              content down rather than covering it. */}
          <button
            type="button"
            onClick={() => setSearchOpen(v => !v)}
            className={`sm:hidden ml-auto w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-lg hover:bg-gray-100 ${searchOpen ? 'bg-gray-100 text-efin-blue' : 'text-gray-500'}`}
            aria-label={searchOpen ? 'Close search' : 'Open search'}
            aria-expanded={searchOpen}
          >
            {searchOpen ? <X size={18} /> : <Search size={18} />}
          </button>

          <div
            className="flex w-8 h-8 shrink-0 rounded-full bg-efin-red text-white items-center justify-center text-xs font-semibold"
            title={user?.fullName}
            aria-hidden="true"
          >
            {getInitials(user?.fullName)}
          </div>
        </header>

        {/* Mobile search row: a normal, in-flow sibling of the header (not
            position:fixed/absolute), so it displaces the page below it
            instead of floating over it. Only mounted on mobile + open. */}
        {isMobile && searchOpen && (
          <div className="sm:hidden bg-white border-b border-gray-200 px-3 py-2 shrink-0">
            <form onSubmit={runSearch} className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={mobileSearchInputRef}
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search loans, customers..."
                aria-label="Search loans and customers"
                className="w-full rounded-lg border border-gray-300 bg-gray-50 pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue focus:bg-white"
              />
            </form>
          </div>
        )}

        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 min-w-0"><Outlet /></main>
      </div>
    </div>
  )
}
