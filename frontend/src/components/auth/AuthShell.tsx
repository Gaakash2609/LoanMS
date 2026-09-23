import React from 'react'
import { BrandLogo } from '@/components/ui/BrandLogo'
import { useBranding } from '@/hooks/useBranding'

// Shared chrome for the three auth screens (Login / Forgot / Reset password).
// Matches the EFFECTIVE Vanilla login (app.css "Design System v2" override at
// 5519+, verified via getComputedStyle on the live /index.html render): a
// dark-blue gradient canvas with two static radial orbs (baked into
// .login-screen's background — no grid, no animated orb divs) and a left
// branding panel, behind a white .login-box.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="login-screen">
      {/* Left panel — hidden below 768px, exactly like Vanilla's .lp-left */}
      <div className="lp-left">
        <div className="lp-badge">🏦 Secure Banking Platform</div>
        <h1 className="lp-headline">
          Financial<br /><span className="lp-hl-accent">Intelligence</span><br />Simplified.
        </h1>
        <p className="lp-desc">
          Manage loan applications, track disbursements, and streamline your
          entire lending workflow — all in one place.
        </p>
      </div>

      <div className="lp-right">
        <div className="login-box">{children}</div>
      </div>
    </div>
  )
}

// The login card's brand slot renders the admin-uploaded sign-in logo when one
// is set (Settings → Logo & Branding → Sign-in Page Logo), otherwise the real
// MudraHub wordmark asset — never the name re-typed as text.
export function AuthLogo() {
  const { signin } = useBranding()
  return (
    <div className="lp-logo-wrap">
      {signin
        ? <img src={signin} alt="Sign in" draggable={false}
            style={{ height: 46, width: 'auto', maxWidth: '100%', objectFit: 'contain', display: 'block' }} />
        : <BrandLogo height={46} />}
    </div>
  )
}

// Login footer — brand chrome only (no business logic). Rebranded from the
// legacy "EFIN v6.2 © 2026" to MudraHub so the copy under the MudraHub logo is
// consistent with the brand. (The many "EFIN-*" strings elsewhere are backend
// workflow/task identifiers, not branding, and are deliberately left untouched.)
export const AUTH_FOOTER = (
  <div className="lp-footer">
    <span>🔒 256-bit SSL Encrypted</span>
    <span>·</span>
    <span>MudraHub © 2026</span>
  </div>
)
