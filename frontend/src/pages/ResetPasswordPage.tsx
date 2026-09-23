import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation } from '@tanstack/react-query'
import { authApi } from '@/api/authApi'
import { AuthShell, AuthLogo, AUTH_FOOTER } from '@/components/auth/AuthShell'

const schema = z.object({
  newPassword: z.string().min(8, 'Min 8 characters'),
  confirmPassword: z.string().min(8, 'Min 8 characters'),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
})
type FormData = z.infer<typeof schema>

export default function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const email = params.get('email') ?? ''
  const [done, setDone] = useState(false)

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  const mutation = useMutation({
    mutationFn: (d: FormData) => authApi.resetPassword({ token, email, ...d }),
    onSuccess: (res) => {
      if (res.data.success) {
        setDone(true)
        setTimeout(() => navigate('/login'), 2500)
      }
    },
  })

  const linkInvalid = !token || !email

  return (
    <AuthShell>
      <AuthLogo />
      <div className="lp-divider" />

      {linkInvalid ? (
        <>
          <div className="lp-forgot-header">
            <div className="lp-forgot-icon">⚠️</div>
            <div className="lp-form-title" style={{ display: 'block', margin: 0, color: 'var(--text)', fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-head)' }}>
              Invalid link
            </div>
            <p className="lp-form-sub" style={{ margin: '8px 0 0' }}>
              This reset link is missing its token. Please request a new one.
            </p>
          </div>
          <Link to="/forgot-password" className="lp-back-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            Request a new link →
          </Link>
        </>
      ) : done ? (
        <div className="lp-forgot-header">
          <div className="lp-forgot-icon">✅</div>
          <div className="lp-form-title" style={{ display: 'block', margin: 0, color: 'var(--text)', fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-head)' }}>
            Password updated
          </div>
          <p className="lp-form-sub" style={{ margin: '8px 0 0' }}>Redirecting you to sign in…</p>
        </div>
      ) : (
        <>
          <p className="lp-form-sub">Set a new password</p>

          {mutation.isSuccess && !mutation.data.data.success && (
            <div className="lp-error-box">
              {mutation.data.data.message || 'The reset link is invalid or has expired.'}
            </div>
          )}
          {mutation.isError && (
            <div className="lp-error-box">Something went wrong. Please try again.</div>
          )}

          <form onSubmit={handleSubmit((d) => mutation.mutate(d))}>
            <div className="lp-field">
              <label className="login-label" htmlFor="reset-new-password">New Password</label>
              <input
                id="reset-new-password"
                className="login-input"
                type="password"
                autoComplete="new-password"
                {...register('newPassword')}
              />
              {errors.newPassword && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{errors.newPassword.message}</p>}
            </div>
            <div className="lp-field">
              <label className="login-label" htmlFor="reset-confirm-password">Confirm New Password</label>
              <input
                id="reset-confirm-password"
                className="login-input"
                type="password"
                autoComplete="new-password"
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{errors.confirmPassword.message}</p>}
            </div>
            <button type="submit" className="login-btn" disabled={mutation.isPending}>
              {mutation.isPending ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </>
      )}

      {AUTH_FOOTER}
    </AuthShell>
  )
}
