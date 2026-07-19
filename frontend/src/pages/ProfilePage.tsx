import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { useAuthStore } from '@/store/authStore'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import PageHeader from '@/components/shared/PageHeader'
import { User, Lock, CheckCircle } from 'lucide-react'

export default function ProfilePage() {
  const user = useAuthStore(s => s.user)
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwError, setPwError] = useState('')

  const changePassword = useMutation({
    mutationFn: () => api.post<ApiResponse<null>>('/api/auth/change-password', pwForm),
    onSuccess: () => {
      setPwSuccess(true)
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setTimeout(() => setPwSuccess(false), 4000)
    },
    onError: () => setPwError('Failed to change password. Check current password and try again.'),
  })

  const handlePwSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setPwError('')
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      setPwError('New passwords do not match.')
      return
    }
    if (pwForm.newPassword.length < 6) {
      setPwError('New password must be at least 6 characters.')
      return
    }
    changePassword.mutate()
  }

  if (!user) return <LoadingSpinner size="lg" />

  return (
    <div className="max-w-2xl">
      <PageHeader title="My Profile" subtitle="View and update your account" />

      <div className="space-y-5">
        <Card>
          <CardHeader title="Account Details" action={<User size={16} className="text-gray-400" />} />
          <div className="grid grid-cols-2 gap-4 text-sm">
            {[
              ['Full Name', user.fullName],
              ['Email',     user.email],
              ['Role',      user.role],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-xs text-gray-500">{label}</p>
                <p className="font-medium text-gray-900 mt-0.5">{value}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Change Password" action={<Lock size={16} className="text-gray-400" />} />
          <form onSubmit={handlePwSubmit} className="space-y-4">
            {[
              { label: 'Current Password', key: 'currentPassword' },
              { label: 'New Password',     key: 'newPassword' },
              { label: 'Confirm Password', key: 'confirmPassword' },
            ].map(f => (
              <div key={f.key}>
                <label className="text-xs font-semibold text-gray-600 uppercase block mb-1">{f.label}</label>
                <input type="password"
                  value={pwForm[f.key as keyof typeof pwForm]}
                  onChange={e => setPwForm(p => ({ ...p, [f.key]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            ))}

            {pwError && <p className="text-sm text-red-600">{pwError}</p>}
            {pwSuccess && (
              <div className="flex items-center gap-2 text-sm text-green-600">
                <CheckCircle size={16} /> Password changed successfully.
              </div>
            )}

            <Button type="submit" loading={changePassword.isPending}>Update Password</Button>
          </form>
        </Card>
      </div>
    </div>
  )
}
