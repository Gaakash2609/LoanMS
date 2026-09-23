import React from 'react'
import { cn } from '@/utils/format'
import { InlineLoader } from '@/components/ui/LoadingSpinner'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, type, ...props }: ButtonProps) {
  // Default to type="button" so a Button placed inside a <form> (a modal's
  // Cancel/X, a row action, a toolbar action, etc.) never triggers an
  // accidental form submit. Every real submit button in the app already passes
  // type="submit" explicitly, so those keep working — the caller's `type`
  // always wins over this default.
  // Geometry, weight and the blue glow come from the legacy .login-btn
  // (see .efin-btn in globals.css). The previous flat bg-efin-blue at weight
  // 500 with an 8px radius was the main reason React buttons read as lighter
  // than the legacy ones. Focus ring is kept so keyboard focus stays visible.
  const base =
    'efin-btn focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--accent)]'
  const variants = {
    primary:   'efin-btn--primary',
    secondary: 'efin-btn--secondary',
    danger:    'efin-btn--danger',
    ghost:     'efin-btn--ghost',
    // Additive — used to visually distinguish positive workflow actions
    // (Approve/Disburse) from the generic primary blue CTA elsewhere.
    success:   'efin-btn--success',
  }
  const sizes = { sm: 'efin-btn--sm', md: 'efin-btn--md', lg: 'efin-btn--lg' }

  return (
    <button type={type ?? 'button'} className={cn(base, variants[variant], sizes[size], className)} disabled={disabled || loading} {...props}>
      {loading && <InlineLoader size={16} className="-ml-1 mr-2" />}
      {children}
    </button>
  )
}
