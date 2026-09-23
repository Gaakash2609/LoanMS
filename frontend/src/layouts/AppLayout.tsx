import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useLoanStore } from '@/store/loanStore'
import { useRolePermissionsQuery, useMenuVisibilityQuery, canAccessMenuItem } from '@/hooks/usePermissions'

import {
  LayoutDashboard, Users, CreditCard, Settings, Menu, X,
  IndianRupee, BarChart3, CheckSquare, Ticket, UserCog, Building2,
  Calculator, FilePlus, MapPin, ClipboardList, Briefcase,
  CreditCard as BankIcon, Grid, Search, ExternalLink, Handshake, KeyRound
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { UserRole } from '@/types'
import NotificationBell from '@/components/shared/NotificationBell'
import TopbarUserMenu from '@/components/shared/TopbarUserMenu'
import { GlobalSearchResults } from '@/components/shared/GlobalSearchResults'
import LoanProductSelectorModal from '@/components/shared/LoanProductSelectorModal'
import { SidebarBrandIcon, SidebarBrandBanner } from '@/components/ui/BrandLogo'
import { useBranding, clampIconSize, clampBannerSize } from '@/hooks/useBranding'

// Closes a results dropdown on any pointerdown outside `ref` -- checked on
// mousedown (not click) so the outside-click handler runs BEFORE a result
// button's own onClick, and `ref` wraps the dropdown itself so clicking a
// result doesn't count as "outside" and swallow the click.
function useCloseOnOutsideClick<T extends HTMLElement>(ref: { current: T | null }, active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [active, ref, onClose])
}

// Turns "Admin General" -> "AG", "System" -> "SY", "" -> "?"

// Legacy's drawer breakpoint is `@media (max-width: 1100px)` (app.css:6952),
// i.e. the off-canvas drawer + hamburger take over at 1100px and narrower.
// This used to be Tailwind's `lg` (1024px), which left a 1025-1100px band
// where legacy showed the drawer but React still showed the desktop rail --
// and it contradicted this file's own comments, which already cited 1100px
// in two places. 1101 as an exclusive bound reproduces `max-width: 1100px`
// exactly. Below it the sidebar is a fixed overlay with a backdrop instead
// of an inline flex column, so it can never squeeze page content.
const MOBILE_BREAKPOINT = 1101

type NavIcon = React.ElementType
// `menuId` links a nav item to its legacy Menu-Access-Control counterpart
// (see constants/permissions.ts's ALL_MENU_ITEMS/NAV_PERM_KEY_BY_MENU_ID).
// Items without one (Customers, CIBIL, Profile, Audit Log, Settings — none
// of these existed as legacy sidebar entries) keep only the static `roles`
// gate, unchanged from before. `menuId` as an array means "visible if ANY
// of these legacy items would be visible" (Teams maps to three legacy
// pages — team-overview/sales-teams/login-teams — collapsed into one link).
// Sidebar sections — mirror Vanilla's grouped .nav-section blocks
// (index.html:381 Main Menu / Management / Team Management / Analytics /
// Policy & Product / Settings). nav-text labels also match Vanilla.
type NavSectionKey = 'main' | 'management' | 'team' | 'analytics' | 'policy' | 'settings'
const NAV_SECTIONS: { key: NavSectionKey; label: string }[] = [
  { key: 'main',       label: 'Main Menu' },
  { key: 'management', label: 'Management' },
  { key: 'team',       label: 'Team Management' },
  { key: 'analytics',  label: 'Analytics' },
  { key: 'policy',     label: 'Policy & Product' },
  { key: 'settings',   label: 'Settings' },
]
interface NavItem { to: string; label: string; icon: NavIcon; section: NavSectionKey; roles?: UserRole[]; menuId?: string | string[] }

const NAV_ITEMS: NavItem[] = [
  // ── Main Menu (Vanilla order: Overview, Applications, Register New, EMI
  // Calculator, Tasks, Payout; React-only Customers/CIBIL appended). ──
  { to: '/dashboard',      label: 'Overview',        icon: LayoutDashboard, section: 'main', menuId: 'dashboard' },
  { to: '/loans',          label: 'Applications',    icon: CreditCard,      section: 'main', menuId: 'applications' },
  { to: '/new-application',label: 'Register New',    icon: FilePlus,        section: 'main', menuId: 'new-application' },
  { to: '/calculator',     label: 'EMI Calculator',  icon: Calculator,      section: 'main', menuId: 'calculator' },
  { to: '/tasks',          label: 'Tasks',           icon: CheckSquare,     section: 'main', menuId: 'tasks-page' },
  { to: '/payout',         label: 'Payout',          icon: IndianRupee,     section: 'main', roles: ['Admin','Manager','Accounts'], menuId: 'payout' },
  // ── Management ──
  { to: '/banks',          label: 'Banks / NBFC',        icon: BankIcon,      section: 'management', roles: ['Admin','Manager','ProductTeam'], menuId: 'banks' },
  { to: '/incred',         label: 'InCred Integration',  icon: ExternalLink,  section: 'management', roles: ['Admin','Manager'], menuId: 'incred' },
  { to: '/lender-config',  label: 'Lender Configuration',icon: Grid,          section: 'management', roles: ['Admin','Manager','ProductTeam'], menuId: 'lender-config' },
  { to: '/dsa',            label: 'DSA Management',      icon: Briefcase,     section: 'management', roles: ['Admin','Manager','Sales','ProductTeam'], menuId: 'dsa-mgmt' },
  { to: '/partners',       label: 'Partner Management',  icon: Handshake,     section: 'management', roles: ['Admin','Manager','Sales','ProductTeam'], menuId: 'partner-mgmt' },
  // ── Team Management (Vanilla: three separate nav items — Team Overview 📊,
  // Sales Teams 👥, Login Teams 🔑 — not one consolidated link, efin-app.js
  // NAV config :785-787). Each is its own page/route now. ──
  { to: '/teams',          label: 'Team Overview',   icon: Building2,     section: 'team', roles: ['Admin','Manager'], menuId: 'team-overview' },
  { to: '/sales-teams',    label: 'Sales Teams',     icon: Users,         section: 'team', roles: ['Admin','Manager'], menuId: 'sales-teams' },
  { to: '/login-teams',    label: 'Login Teams',     icon: KeyRound,      section: 'team', roles: ['Admin','Manager'], menuId: 'login-teams' },
  { to: '/locations',      label: 'Locations',       icon: MapPin,        section: 'team', roles: ['Admin','Manager'], menuId: 'locations-mgmt' },
  { to: '/users',          label: 'Users',           icon: UserCog,       section: 'team', roles: ['Admin'], menuId: 'users-mgmt' },
  // ── Analytics ──
  // roles MUST mirror the matching guard in AppRoutes.tsx exactly.
  { to: '/reports',        label: 'Reports',           icon: BarChart3,   section: 'analytics', roles: ['Admin','Manager','TeamLeader','LoginTeam','LocationHead','OperationManager'], menuId: 'reports' },
  { to: '/tickets',        label: 'Helpdesk Tickets',  icon: Ticket,      section: 'analytics', menuId: 'tickets' },
  // ── Policy & Product ──
  { to: '/policy-product', label: 'Policy & Product', icon: Grid,         section: 'policy', roles: ['Admin','ProductTeam'], menuId: 'policy-product' },
  // ── Settings (React-only admin items + profile grouped here) ──
  { to: '/settings',       label: 'Settings',        icon: Settings,      section: 'settings', roles: ['Admin'] },
  { to: '/audit',          label: 'Audit Log',       icon: ClipboardList, section: 'settings', roles: ['Admin'] },
  // Security Roles is NOT a sidebar item in Vanilla — it's the Settings →
  // "Roles & Permissions" tab (SettingsPage hosts RolesPermissionsTab). The
  // /security-roles route still exists for direct access; removed from nav
  // to match Vanilla's information architecture.
  // My Profile is reached from the topbar user-menu (TopbarUserMenu), like
  // Vanilla — not a sidebar item.
]

// Vanilla's .topbar-title shows the CURRENT PAGE name (set by showPage()),
// not a static app name — e.g. "Dashboard", "Applications". Labels use
// Vanilla's own page/nav names (verified on the live /index.html render).
const TOPBAR_TITLES: { prefix: string; title: string }[] = [
  { prefix: '/dashboard',       title: 'Dashboard' },
  { prefix: '/new-application', title: 'New Application' },
  { prefix: '/loans/new',       title: 'New Application' },
  { prefix: '/loans',           title: 'Applications' },
  { prefix: '/calculator',      title: 'EMI Calculator' },
  { prefix: '/tasks',           title: 'Tasks' },
  { prefix: '/tickets',         title: 'Helpdesk Tickets' },
  { prefix: '/profile',         title: 'Profile' },
  { prefix: '/payout',          title: 'Payout' },
  { prefix: '/reports',         title: 'Reports' },
  { prefix: '/teams',           title: 'Team Overview' },
  { prefix: '/sales-teams',     title: 'Sales Teams' },
  { prefix: '/login-teams',     title: 'Login Teams' },
  { prefix: '/dsa',             title: 'DSA Management' },
  { prefix: '/partners',        title: 'Partner Management' },
  { prefix: '/locations',       title: 'Locations' },
  { prefix: '/banks',           title: 'Banks & NBFCs' },
  { prefix: '/lender-config',   title: 'Lender Configuration' },
  { prefix: '/incred',          title: 'InCred Integration' },
  { prefix: '/users',           title: 'Users' },
  { prefix: '/security-roles',  title: 'Security Roles' },
  { prefix: '/policy-product',  title: 'Policy & Product' },
  { prefix: '/audit',           title: 'Audit Log' },
  { prefix: '/settings',        title: 'Settings' },
]
function topbarTitle(pathname: string): string {
  // A loan detail (/loans/<id>) is Vanilla's "Application Detail", distinct
  // from the "Applications" list — the tracking sub-route keeps its own title.
  if (/^\/loans\/\d+$/.test(pathname)) return 'Application Detail'
  if (/^\/loans\/\d+\/tracking$/.test(pathname)) return 'Application Timeline'
  // longest-prefix match so /loans/new beats /loans
  const hit = [...TOPBAR_TITLES].sort((a, b) => b.prefix.length - a.prefix.length)
    .find(t => pathname === t.prefix || pathname.startsWith(t.prefix + '/'))
  return hit?.title ?? 'Dashboard'
}

function isMobileViewport() {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
}

export default function AppLayout() {
  const user     = useAuthStore(s => s.user)
  const location = useLocation()
  const navigate = useNavigate()
  const setLoanFilter = useLoanStore(s => s.setFilter)

  // Two independent concerns, deliberately kept separate:
  // - isMobile: which layout mode we're in (drawer vs inline column)
  // - open: whether the sidebar is visible right now
  const [isMobile, setIsMobile] = useState(isMobileViewport)
  // `open` is the MOBILE DRAWER only. On desktop the legacy sidebar has no
  // open/closed state at all — it is permanently a 64px icon rail that widens
  // purely on hover (the legacy hamburger is `display:none` until <=1100px),
  // so it must start closed and never gate the desktop width.
  const [open, setOpen] = useState(false)
  // Desktop-only: pointer is currently over the collapsed rail.
  const [railHovered, setRailHovered] = useState(false)

  // Loan Product Selector — legacy shows this premium card grid before
  // entering the wizard (efin-app.js openLoanProductSelector/
  // proceedWithLoanProduct); the sidebar nav item now opens it instead of
  // navigating straight to the plain-dropdown wizard.
  const [showProductSelector, setShowProductSelector] = useState(false)
  // Collapsible sidebar sections — Vanilla's toggleNavSection() (chevron).
  const [collapsedNav, setCollapsedNav] = useState<Set<NavSectionKey>>(new Set())
  const toggleNavSection = (key: NavSectionKey) =>
    setCollapsedNav(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n })

  // Header search. On >=sm it's an always-visible inline input; on mobile
  // it's collapsed behind a search icon (there's no room in a 320px header
  // for a logo + inline input + avatar) and expands into its own full-width
  // row that pushes content down, so it's never stacked on top of anything.
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const mobileSearchInputRef = useRef<HTMLInputElement>(null)

  // Results dropdown, driven by the SAME `query` the submit handler already
  // used to only navigate to /loans. `resultsFocused` tracks whether either
  // search input currently owns focus; the form's own ref lets outside
  // clicks close the dropdown without swallowing a click on a result.
  const [resultsFocused, setResultsFocused] = useState(false)
  const desktopSearchRef = useRef<HTMLFormElement>(null)
  const mobileSearchRef = useRef<HTMLFormElement>(null)
  const showResults = resultsFocused && query.trim().length >= 2
  useCloseOnOutsideClick(desktopSearchRef, showResults, () => setResultsFocused(false))
  useCloseOnOutsideClick(mobileSearchRef, showResults, () => setResultsFocused(false))

  const runSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    setLoanFilter({ search: q })
    navigate('/loans')
    setSearchOpen(false)
  }

  // The Applications page can clear the applied search itself ("Clear search" /
  // "Reset search & filters"). When the store's search goes empty, empty the
  // header box too so it never keeps showing a term that is no longer applied.
  // Only reacts to the store changing, so text typed but not yet submitted is safe.
  const appliedSearch = useLoanStore(s => s.filter.search)
  useEffect(() => {
    if (!appliedSearch) setQuery('')
  }, [appliedSearch])

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
        // Crossing the breakpoint: the drawer is always closed in the new
        // mode — on desktop it is not a drawer at all (hover rail), and on
        // mobile it must not pop open just because the window was resized.
        setOpen(false)
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

  // Dynamic nav visibility — reads the same server-persisted permissions
  // blob the "Roles & Permissions" admin editor (Settings tab) writes to,
  // so toggling a menu item there takes effect here without a code change.
  // For nav items with no legacy menu-id mapping, or while the permissions
  // queries are still loading, the static `roles` allowlist below remains
  // the sole gate (unchanged behavior) — this only adds enforcement where a
  // real legacy counterpart exists, it never removes the safety net.
  const { data: rolePermissions } = useRolePermissionsQuery()
  const { data: menuVisibility } = useMenuVisibilityQuery()

  const items = NAV_ITEMS.filter(i => {
    const staticAllowed = !i.roles || (user?.role && i.roles.includes(user.role as UserRole))
    if (!i.menuId) return staticAllowed
    const menuIds = Array.isArray(i.menuId) ? i.menuId : [i.menuId]
    const dynamicResults = menuIds.map(id => canAccessMenuItem(id, user?.role, rolePermissions, menuVisibility))
    if (dynamicResults.every(r => r === undefined)) return staticAllowed
    // BUGFIX: this used to return `dynamicResults.some(...)` alone, letting a
    // `true` from the permissions blob OVERRIDE the static `roles` list. Since
    // that list mirrors the route guard in AppRoutes.tsx, any role whose
    // canNav* flag was true saw a menu entry whose route then bounced it
    // straight back to /dashboard — 29 such (role, route) pairs across 8
    // roles, e.g. LocationHead seeing Users (canNavUsers=true) against a
    // route guard of ['Admin'].
    //
    // The static list is now a hard ceiling: the dynamic permission can only
    // ever REMOVE an item an admin has switched off, never reveal one the
    // route would refuse. This strictly narrows what is shown — it grants
    // nothing, and neither the route guards nor any API authorization change.
    return staticAllowed && dynamicResults.some(r => r === true)
  })

  // Sidebar hover-expand (legacy `.sidebar:hover`). Driven by explicit
  // state + inline width rather than Tailwind width classes: the class-based
  // approach was being overridden somewhere in the cascade, and an inline
  // width is unambiguous.
  //
  // BUGFIX: this used to be `isMobile || open || railHovered`, and `open`
  // defaulted to true on desktop — so the rail was pinned at 260px from the
  // first paint and the hover-expand could never be seen. On desktop the only
  // thing that expands it is hover, exactly like legacy's `.sidebar:hover`.
  // On mobile the drawer is a full-width panel, so labels are always shown.
  const expanded = isMobile || railHovered
  // Only hover-capable pointers get the expand, so a tap on a touch device
  // can't leave the rail stuck open — same intent as legacy's
  // @media (hover: hover) guard.
  const hoverCapable = () =>
    typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches

  // Labels are always rendered on desktop so they can fade in on hover
  // without a remount.
  const labelCls = expanded ? 'opacity-100' : 'opacity-0'

  // Admin-configured branding (Settings → Logo & Branding). Uploaded icon/
  // banner override the default MudraHub assets; the Icon/Banner Size sliders
  // drive the rendered size; a rebranded name/subtitle show as text when no
  // banner image is set. Read live for every role via the public branding keys.
  const branding = useBranding()

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Backdrop: only rendered on mobile while the drawer is open, sits
          behind the sidebar and above page content, closes the drawer on tap. */}
      {isMobile && open && (
        <div
          className="fixed inset-0 z-[var(--z-sidebar-overlay)] bg-black/40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Desktop spacer — reserves space for the rail so the fixed-position
          <aside> below never sits on top of page content.
          BUGFIX: this used to be a static `var(--sidebar-collapsed-w)`
          (64px) regardless of hover state. Since the <aside> is
          `position:fixed`, it isn't part of this flex row's own layout — so
          when hovering widened it to `var(--sidebar-w)` (260-320px) the
          spacer never grew to match, and the expanded rail simply overlaid
          the first ~200px of the page (title, filter pills and the first
          KPI card all partly hidden behind it — the "pages overlap" bug).
          The spacer now tracks the same `expanded` flag the <aside> uses,
          with the identical width + timing, so hovering pushes the page
          content over in step with the rail instead of covering it. */}
      {!isMobile && (
        <div
          className="shrink-0"
          aria-hidden="true"
          style={{
            width: expanded ? 'var(--sidebar-w)' : 'var(--sidebar-collapsed-w)',
            transition: 'width .28s cubic-bezier(.4,0,.2,1)',
          }}
        />
      )}

      {/* Legacy `.sidebar` is a WHITE panel (#fff) with a #ebebeb right
          border and a soft shadow — not the dark navy this SPA used. On
          desktop it sits at 64px and expands to 260px on hover (hover-
          capable pointers only, same @media (hover: hover) guard legacy
          uses). The spacer above now grows in lockstep, so the page content
          is pushed aside rather than covered while it's expanded. */}
      <aside
        onMouseEnter={() => { if (!isMobile && hoverCapable()) setRailHovered(true) }}
        onMouseLeave={() => { if (!isMobile) setRailHovered(false) }}
        className={`
          bg-white flex flex-col overflow-hidden border-r border-[#ebebeb]
          ${isMobile
            ? `fixed inset-y-0 left-0 z-[var(--z-sidebar)] w-[280px] shadow-[1px_0_0_#ebebeb,2px_0_12px_rgba(0,0,0,.05)] transition-transform duration-200 ${open ? 'translate-x-0' : '-translate-x-full'}`
            : 'fixed inset-y-0 left-0 z-[var(--z-sidebar)]'
          }
        `}
        style={isMobile ? undefined : {
          // Read the width from the CSS custom properties rather than
          // hard-coding 260 — --sidebar-w steps up to 280/300/320px on
          // large displays (globals.css), and a literal 260 here silently
          // ignored every one of those breakpoints.
          width: expanded ? 'var(--sidebar-w)' : 'var(--sidebar-collapsed-w)',
          // Legacy timing/easing verbatim: width .28s cubic-bezier(.4,0,.2,1)
          // plus the deeper drop-shadow that lifts the panel over the page
          // while it is expanded.
          transition: 'width .28s cubic-bezier(.4,0,.2,1), box-shadow .28s ease',
          boxShadow: expanded
            ? '4px 0 28px rgba(0,0,0,.10)'
            : '1px 0 0 #ebebeb, 2px 0 12px rgba(0,0,0,.05)',
        }}
      >
        <div className="flex items-center justify-center gap-3 px-4 border-b border-[#ebebeb]" style={{ height: 'var(--topbar-h)' }}>
          {/* Vanilla's dual-logo zone: the compact square monogram in the
              collapsed 64px rail, the full wordmark when expanded — exactly ONE
              at a time (Vanilla fades the icon out and the banner in).
              BUGFIX: this used to render BOTH <BrandMark> and <BrandLogo> and
              toggle them with Tailwind's `hidden` class — but both components
              set an inline `display:block`, which overrides a `display:none`
              class, so neither ever hid. The result was the monogram AND the
              wordmark showing together when expanded, and the wide wordmark
              bleeding out of the 64px rail when collapsed. Rendering only the
              active one removes any reliance on class-vs-inline precedence.
              Sizes are tuned to the 68px header: 42px gives the wordmark real
              presence (like Vanilla's banner slot) and keeps the baked-in
              "Clarity. Confidence. Capital" tagline legible, while still fitting
              the narrowest 260px rail; maxWidth keeps it safe next to the mobile
              drawer's close button. */}
          {expanded
            ? <SidebarBrandBanner
                bannerSrc={branding.banner}
                height={clampBannerSize(branding.bannerSize)}
                name={branding.name}
                sub={branding.sub}
                asText={branding.nameCustomized}
              />
            : <SidebarBrandIcon src={branding.icon} size={clampIconSize(branding.iconSize)} />}
          {isMobile && (
            <button
              onClick={() => setOpen(false)}
              className="ml-auto p-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700"
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          )}
        </div>
        {/* Grouped nav — Vanilla's .nav-section blocks (index.html:381). Each
            section shows a .nav-label header (with a collapse chevron) when the
            rail is expanded; collapsed the rail is icon-only, exactly like
            Vanilla. */}
        <nav className={`flex-1 py-3 overflow-y-auto overflow-x-hidden sidebar-nav-scroll ${expanded ? 'px-2' : 'px-0'}`}>
          {NAV_SECTIONS.map((section, si) => {
            const sectionItems = items.filter(i => i.section === section.key)
            if (!sectionItems.length) return null
            const collapsed = collapsedNav.has(section.key)
            return (
              <div key={section.key} className={si > 0 ? 'mt-1.5' : ''}>
                {expanded ? (
                  <button
                    type="button"
                    onClick={() => toggleNavSection(section.key)}
                    className="w-full flex items-center justify-between px-3 pt-2 pb-1 select-none"
                  >
                    <span className="text-[10px] font-bold uppercase" style={{ letterSpacing: '1px', color: 'var(--text3)' }}>{section.label}</span>
                    <span className="text-[10px] transition-transform" style={{ color: 'var(--text3)', transform: collapsed ? 'rotate(-90deg)' : 'none' }}>▾</span>
                  </button>
                ) : si > 0 ? <div className="mx-3 my-1.5 border-t" style={{ borderColor: '#ebebeb' }} /> : null}
                {!(expanded && collapsed) && (
                  <div className="space-y-0.5">
                    {sectionItems.map(({ to, label, icon: Icon }) => (
                      <NavLink key={to} to={to}
                        onClick={e => {
                          if (to === '/new-application') { e.preventDefault(); setShowProductSelector(true) }
                        }}
                        className={({ isActive }) =>
                          `efin-nav-item ${expanded ? 'efin-nav-item--expanded' : ''} ${isActive ? 'efin-nav-item--active' : ''}`}>
                        <span className="efin-nav-icon">
                          <Icon size={18} className="shrink-0" />
                        </span>
                        <span className={`whitespace-nowrap transition-opacity duration-200 ${labelCls}`}>{label}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
        {/* The bottom user/logout block was removed — the topbar profile menu
            (TopbarUserMenu) already shows the signed-in user and provides
            Logout, so this sidebar footer was redundant. */}
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
        <header className="efin-topbar flex items-center shrink-0">
          {/* Mobile only — legacy's .hamburger-btn is `display:none` until the
              <=1100px media query, because on desktop there is nothing to
              toggle: the rail is always there and expands on hover. */}
          {isMobile && (
            <button
              onClick={() => setOpen(!open)}
              className="efin-topbar-icon-btn"
              aria-label={open ? 'Close menu' : 'Open menu'}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
          )}

          {/* Vanilla .topbar-title (app.css:4904): the current PAGE name in
              font-head 18px/800, not a static app name. */}
          <span
            className="truncate min-w-0"
            style={{ fontFamily: 'var(--font-head)', fontSize: 18, fontWeight: 800, letterSpacing: '-.4px', color: 'var(--text)' }}
          >
            {topbarTitle(location.pathname)}
          </span>

          {/* Inline search — tablet & desktop only, sits in normal flow so it
              can never overlap the hamburger or the title next to it. */}
          <form ref={desktopSearchRef} onSubmit={runSearch} className="hidden sm:flex flex-1 min-w-0 max-w-xs ml-auto relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => setResultsFocused(true)}
              placeholder="Search loans, customers..."
              aria-label="Search loans and customers"
              className="efin-topbar-search text-sm"
            />
            {showResults && (
              <GlobalSearchResults query={query} onNavigate={() => { setResultsFocused(false); setQuery('') }} />
            )}
          </form>

          {/* Mobile search trigger — replaces the inline input with an icon
              button so the header never has to squeeze five things into
              ~320px. Opens the row below instead of an overlay, so it pushes
              content down rather than covering it. */}
          <button
            type="button"
            onClick={() => setSearchOpen(v => !v)}
            className={`efin-topbar-icon-btn sm:hidden ml-auto ${searchOpen ? 'text-efin-blue' : ''}`}
            aria-label={searchOpen ? 'Close search' : 'Open search'}
            aria-expanded={searchOpen}
          >
            {searchOpen ? <X size={18} /> : <Search size={18} />}
          </button>

          <NotificationBell />

          {/* Vanilla's topbar profile dropdown (avatar → My Profile / Change
              Password / Logout). Replaces the static avatar badge. */}
          <TopbarUserMenu />
        </header>

        {/* Mobile search row: a normal, in-flow sibling of the header (not
            position:fixed/absolute), so it displaces the page below it
            instead of floating over it. Only mounted on mobile + open. */}
        {isMobile && searchOpen && (
          <div className="sm:hidden bg-white border-b border-gray-200 px-3 py-2 shrink-0">
            <form ref={mobileSearchRef} onSubmit={runSearch} className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={mobileSearchInputRef}
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onFocus={() => setResultsFocused(true)}
                placeholder="Search loans, customers..."
                aria-label="Search loans and customers"
                className="efin-topbar-search text-sm"
              />
              {showResults && (
                <GlobalSearchResults query={query} onNavigate={() => { setResultsFocused(false); setQuery(''); setSearchOpen(false) }} />
              )}
            </form>
          </div>
        )}

        {/* Legacy animated every page swap via `.page.active`
            (animation: pageFadeIn .3s cubic-bezier(.4,0,.2,1)); React had no
            route transition at all, so navigation snapped. The `key` is what
            makes it work: changing it on every pathname remounts the wrapper,
            which restarts the CSS animation. Without the key the class is
            already applied and the animation never replays. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 min-w-0">
          <div key={location.pathname} className="efin-page">
            <Outlet />
          </div>
        </main>
      </div>

      {showProductSelector && (
        <LoanProductSelectorModal
          onClose={() => setShowProductSelector(false)}
          onSelect={loanType => {
            setShowProductSelector(false)
            navigate('/new-application', { state: { initialLoanType: loanType } })
          }}
        />
      )}
    </div>
  )
}
