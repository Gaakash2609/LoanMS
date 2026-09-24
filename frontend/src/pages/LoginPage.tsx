import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff } from 'lucide-react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useLogin } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/authStore'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { AuthShell, AuthLogo, AUTH_FOOTER } from '@/components/auth/AuthShell'

const schema = z.object({
  email:      z.string().email('Invalid email'),
  password:   z.string().min(6, 'Min 6 characters'),
  rememberMe: z.boolean().optional(),
})
type FormData = z.infer<typeof schema>

// Distinguish a real credential failure from a rate-limit / outage / network
// error — showing "Invalid email or password" for a 429 or a 500 sends the
// user down the wrong path (retyping a correct password that's being blocked).
function loginErrorMessage(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status
  if (status === 429) return 'Too many sign-in attempts. Please wait a minute and try again.'
  if ((err as { code?: string })?.code === 'ERR_NETWORK') return 'Could not reach the server. Check your connection and try again.'
  if ((err as { code?: string })?.code === 'ECONNABORTED') return 'The server took too long to respond. Please try again.'
  if (status != null && status >= 500) return 'The server had a problem signing you in. Please try again shortly.'
  // Server-reported refusal with HTTP 200 (account lockout) — useLogin throws
  // it as a plain Error carrying the server's own message.
  if (status == null && err instanceof Error && err.message) return err.message
  return 'Invalid email or password. Please try again.'
}

export default function LoginPage() {
  const login = useLogin()
  // Password show/hide — Vanilla's login (source of truth) has an eye toggle
  // inside the password field; React was missing it (parity fix).
  const [showPassword, setShowPassword] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const { isAuthenticated, hasHydrated } = useAuthStore()
  const location = useLocation()

  // Same rehydration race as ProtectedRoute: don't render the login form (or
  // decide to redirect away from it) until the persisted session has
  // actually been read back from localStorage.
  if (!hasHydrated) return <PageLoader />

  // Already logged in (e.g. this tab reloaded while sitting on /login, or
  // the user navigated back here manually) — send them back to whatever
  // page they came from instead of making them log in again.
  if (isAuthenticated) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from || '/dashboard'} replace />
  }

  return (
    <AuthShell>
      <AuthLogo />
      <div className="lp-divider" />
      <p className="lp-form-sub">Sign in to your secure account</p>

      {login.error && (
        <div className="lp-error-box">{loginErrorMessage(login.error)}</div>
      )}

      <form onSubmit={handleSubmit((d) => login.mutate(d))}>
        <div className="lp-field">
          <label className="login-label" htmlFor="login-email">Email Address</label>
          <input
            id="login-email"
            className="login-input"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            {...register('email')}
          />
          {errors.email && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{errors.email.message}</p>}
        </div>

        <div className="lp-field">
          <label className="login-label" htmlFor="login-password">Password</label>
          <div style={{ position: 'relative' }}>
            <input
              id="login-password"
              className="login-input"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              autoComplete="current-password"
              style={{ paddingRight: 42 }}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                color: 'var(--text2, #6b7280)', display: 'flex', alignItems: 'center',
              }}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {errors.password && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{errors.password.message}</p>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '10px 0 16px' }}>
          <label className="lp-remember">
            <input type="checkbox" className="lp-checkbox" {...register('rememberMe')} />
            <span className="lp-check-box" />
            Remember me
          </label>
          <Link to="/forgot-password" className="lp-forgot-btn" style={{ textDecoration: 'none' }}>
            Forgot password?
          </Link>
        </div>

        <button type="submit" className="login-btn" disabled={login.isPending}>
          {login.isPending ? 'Signing in…' : 'Sign In →'}
        </button>
      </form>

      {/* REMOVED: a leftover legacy-era panel that told the operator "a
          setup wizard should have appeared automatically" and, failing
          that, to open DevTools (F12) and run `localStorage.clear();
          location.reload();`.

          Both halves were wrong. There is no setup wizard anywhere in
          this codebase - not in the React routes and not in the legacy
          wwwroot JS either - so the panel described a feature that does
          not exist. And instructing users of a lending system to paste
          commands into the browser console is the exact shape of a
          self-XSS social-engineering attack; it should not be taught as
          normal practice on a login screen. Nothing else referenced this
          block, and no application state depends on it. */}

      {AUTH_FOOTER}
    </AuthShell>
  )
}
