import { NavLink, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useLogout } from '@/hooks/useAuth'

import {
  LayoutDashboard, Users, CreditCard, Settings, LogOut, Menu, X,
  IndianRupee, BarChart3, CheckSquare, Ticket, UserCog, Building2,
  Calculator, FilePlus, MapPin, UserCircle, ClipboardList, Briefcase,
  CreditCard as BankIcon, Shield, Grid, Search, ExternalLink
} from 'lucide-react'
import { useState } from 'react'
import type { UserRole } from '@/types'

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
  { to: '/payout',         label: 'Payout',          icon: IndianRupee,   roles: ['Admin','Manager'] },
  { to: '/reports',        label: 'Reports',         icon: BarChart3,     roles: ['Admin','Manager'] },
  { to: '/teams',          label: 'Teams',           icon: Building2,     roles: ['Admin','Manager'] },
  { to: '/dsa',            label: 'DSA',             icon: Briefcase,     roles: ['Admin','Manager'] },
  { to: '/locations',      label: 'Locations',       icon: MapPin,        roles: ['Admin','Manager'] },
  { to: '/banks',          label: 'Banks',           icon: BankIcon,      roles: ['Admin','Manager'] },
  { to: '/lender-config',  label: 'Lender Config',   icon: Grid,          roles: ['Admin','Manager'] },
  { to: '/incred',         label: 'InCred',          icon: ExternalLink,  roles: ['Admin','Manager'] },
  // Admin only
  { to: '/users',          label: 'Users',           icon: UserCog,       roles: ['Admin'] },
  { to: '/security-roles', label: 'Security Roles',  icon: Shield,        roles: ['Admin'] },
  { to: '/policy-product', label: 'Policy Matrix',   icon: Grid,          roles: ['Admin'] },
  { to: '/audit',          label: 'Audit Log',       icon: ClipboardList, roles: ['Admin'] },
  { to: '/settings',       label: 'Settings',        icon: Settings,      roles: ['Admin'] },
]

export default function AppLayout() {
  const user   = useAuthStore(s => s.user)
  const logout = useLogout()
  const [open, setOpen] = useState(true)

  const items = NAV_ITEMS.filter(i => !i.roles || (user?.role && i.roles.includes(user.role as UserRole)))

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <aside className={`${open ? 'w-56' : 'w-14'} bg-[#1e3a5f] flex flex-col transition-all duration-200 shrink-0 overflow-hidden`}>
        <div className="flex items-center gap-3 p-4 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center shrink-0 p-1">
            <img src="/assets/logo-004.png" alt="Mudrahub Logo" className="w-full h-full object-contain" />
          </div>
          {open && <span className="text-white font-semibold text-sm truncate">EFIN LoanMS</span>}
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-white/20 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`}>
              <Icon size={16} className="shrink-0" />
              {open && <span className="truncate text-xs">{label}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          {open && (
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
            {open && 'Logout'}
          </button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0">
          <button onClick={() => setOpen(!open)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
          <img src="/assets/logo-004.png" alt="Mudrahub Logo" className="w-6 h-6 object-contain" />
          <span className="text-sm text-gray-500">EFIN Enterprise Loan Management</span>
        </header>
        <main className="flex-1 overflow-y-auto p-6"><Outlet /></main>
      </div>
    </div>
  )
}
