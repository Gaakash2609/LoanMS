import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useLogin } from '@/hooks/useAuth'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

const schema = z.object({
  email:    z.string().email('Invalid email'),
  password: z.string().min(6, 'Min 6 characters'),
})
type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const login = useLogin()
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  return (
    <div className="min-h-screen bg-gradient-to-br from-efin-blue-dark to-efin-blue flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-4 p-2">
            <img src="/assets/logo-004.png" alt="Mudrahub Logo" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-white">EFIN LoanMS</h1>
          <p className="text-white/70 text-sm mt-1">Enterprise Loan Management System</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Sign in to your account</h2>

          {login.error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              Invalid email or password. Please try again.
            </div>
          )}

          <form onSubmit={handleSubmit((d) => login.mutate(d))} className="space-y-4">
            <Input
              label="Email address"
              type="email"
              autoComplete="email"
              error={errors.email?.message}
              {...register('email')}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              error={errors.password?.message}
              {...register('password')}
            />
            <Button type="submit" className="w-full" loading={login.isPending} size="lg">
              Sign in
            </Button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-6">
            EFIN Enterprise Loan Management System v2.0
          </p>
        </div>
      </div>
    </div>
  )
}
