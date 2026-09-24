// Teams page presentational helpers — extracted verbatim from TeamsPage.tsx
// (code-quality refactor, no behaviour change).

export function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

// Per-name avatar colour — verbatim port of legacy twAvi / TW_AVATARS
// (efin-app.js:24333-24334): a square, coloured tile (not a fixed-blue round
// chip) whose colour is derived from the name's first+last char code.
export const TW_AVATARS = ['#1a4fa3', '#e31e25', '#ffb347', '#a159ff', '#f472b6', '#10b981', '#ff4560', '#0ea5e9']
export function avatarColor(name: string) {
  const n = name || ''
  return TW_AVATARS[Math.abs((n.charCodeAt(0) || 0) + (n.charCodeAt(n.length - 1) || 0)) % TW_AVATARS.length]
}

// Legacy twPillCell member pills (efin-app.js:24846): Sales = accent-blue tint,
// Login = green tint; show up to 3, then a "+N" overflow chip.
export const MEMBER_PILL: Record<'Sales' | 'Login', { bg: string; color: string }> = {
  Sales: { bg: 'rgba(10,88,154,.1)', color: 'var(--accent)' },
  Login: { bg: 'rgba(16,185,129,.1)', color: '#10b981' },
}
