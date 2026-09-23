// Route map: React path  <->  Vanilla index.html "page" concept.
// vanillaNav = the data-page / hash / nav item id used to open that page in
// the vanilla app (edit if your vanilla app uses a different mechanism -
// e.g. onclick="showPage('dashboard')" vs a hash router). The harness reads
// this generically: it just navigates and clicks whatever is on the page.

export const PAGES = [
  { name: 'Dashboard',        reactPath: '/dashboard',        vanillaHash: '#dashboard' },
  { name: 'Applications',     reactPath: '/loans',            vanillaHash: '#applications' },
  { name: 'New Application',  reactPath: '/new-application',  vanillaHash: '#new-application' },
  { name: 'Calculator',       reactPath: '/calculator',       vanillaHash: '#calculator' },
  { name: 'Reports',          reactPath: '/reports',          vanillaHash: '#reports' },
  { name: 'Payout',           reactPath: '/payout',           vanillaHash: '#payout' },
  { name: 'InCred',           reactPath: '/incred',           vanillaHash: '#incred' },
  { name: 'Lender Config',    reactPath: '/lender-config',    vanillaHash: '#lender-config' },
  { name: 'Banks',            reactPath: '/banks',            vanillaHash: '#banks' },
  { name: 'Locations',        reactPath: '/locations',        vanillaHash: '#locations-mgmt' },
  { name: 'Tasks',            reactPath: '/tasks',            vanillaHash: '#tasks-page' },
  { name: 'Tickets',          reactPath: '/tickets',          vanillaHash: '#tickets' },
  { name: 'Profile',          reactPath: '/profile',          vanillaHash: '#page-profile' },
  { name: 'Settings',         reactPath: '/settings',         vanillaHash: '#settings' },
  { name: 'Policy/Product',   reactPath: '/policy-product',   vanillaHash: '#policy-product' },
  { name: 'Security Roles',   reactPath: '/security-roles',   vanillaHash: '#settings' },
  { name: 'Users',            reactPath: '/users',            vanillaHash: '#users-mgmt' },
  { name: 'DSA',              reactPath: '/dsa',              vanillaHash: '#dsa-mgmt' },
  { name: 'Partners',         reactPath: '/partners',         vanillaHash: '#partner-mgmt' },
  { name: 'Teams',            reactPath: '/teams',            vanillaHash: '#team-overview' },
  { name: 'Customers',        reactPath: '/customers',        vanillaHash: null }, // React-only
  { name: 'CIBIL',            reactPath: '/cibil',             vanillaHash: null }, // React-only standalone
]

// Loan Detail is opened from Applications by clicking a row - handled by
// loanDetail.mjs separately since it needs a real loan id + has 11 tabs.

// New Application wizard products - each drives a different dynamic step set.
export const WIZARD_PRODUCTS = [
  'personal', 'business', 'home', 'lap', 'car', 'education', 'insurance',
]

// Buttons/actions the crawler will find but must NOT click (destructive,
// or navigates away to something we test separately / logs the session out).
export const SKIP_TEXT_PATTERNS = [
  /logout/i, /log out/i, /sign out/i,
  /delete/i, /remove/i, /deactivate/i, /reject\b/i,
  /^cancel$/i, // handled explicitly inside modal flows, not blind-clicked
]

export const CREDENTIALS = {
  email: 'admin@efin.com',
  password: 'Admin@123',
}

export const REACT_BASE = process.env.REACT_BASE || 'http://localhost:5099'
export const VANILLA_BASE = process.env.VANILLA_BASE || 'http://localhost:5099/index.html'
