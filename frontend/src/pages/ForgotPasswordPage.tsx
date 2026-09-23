import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { authApi } from '@/api/authApi'
import { AuthShell, AuthLogo, AUTH_FOOTER } from '@/components/auth/AuthShell'

const schema = z.object({
  email: z.string().email('Invalid email'),
})
type FormData = z.infer<typeof schema>

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const mutation = useMutation({
    mutationFn: authApi.forgotPassword,
    onSuccess: () => setSent(true),
    // Backend always returns success=true here (prevents user enumeration),
    // so we don't need to branch on failure — just show the same message.
  })

  return (
    <AuthShell>
      <AuthLogo />
      <div className="lp-divider" />

      {sent ? (
        <>
          <div className="lp-forgot-header">
            <div className="lp-forgot-icon">📧</div>
            <div className="lp-form-title" style={{ display: 'block', margin: 0, color: 'var(--text)', fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-head)' }}>
              Check your email
            </div>
            <p className="lp-form-sub" style={{ margin: '8px 0 0' }}>
              If an account with that email exists, a password reset link has
              been sent. It will expire in a few minutes, so use it soon.
            </p>
          </div>
          <Link to="/login" className="lp-back-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            ← Back to Sign In
          </Link>
        </>
      ) : (
        <>
          <div className="lp-forgot-header">
            <div className="lp-forgot-icon">🔑</div>
            <div className="lp-form-title" style={{ display: 'block', margin: 0, color: 'var(--text)', fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-head)' }}>
              Reset Password
            </div>
            <p className="lp-form-sub" style={{ margin: '4px 0 0' }}>
              Enter your email to receive reset instructions
            </p>
          </div>

          {mutation.isError && (
            <div className="lp-error-box">Something went wrong. Please try again.</div>
          )}

          <form onSubmit={handleSubmit((d) => mutation.mutate(d))}>
            <div className="lp-field">
              <label className="login-label" htmlFor="forgot-email">Email Address</label>
              <input
                id="forgot-email"
                className="login-input"
                type="email"
                placeholder="you@company.com"
                autoComplete="email"
                {...register('email')}
              />
              {errors.email && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{errors.email.message}</p>}
            </div>
            <button type="submit" className="login-btn" disabled={mutation.isPending} style={{ marginTop: 4 }}>
              {mutation.isPending ? 'Sending…' : 'Send Reset Link'}
            </button>
          </form>

          <Link to="/login" className="lp-back-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            ← Back to Sign In
          </Link>
        </>
      )}

      {AUTH_FOOTER}
    </AuthShell>
  )
}
