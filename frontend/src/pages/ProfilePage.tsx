import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/api/axios'
import type { ApiResponse } from '@/types'
import { useAuthStore } from '@/store/authStore'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import PageHeader from '@/components/shared/PageHeader'
import { Lock, CheckCircle, MapPin, Landmark, Camera, Pencil, X } from 'lucide-react'
import { usersApi, type UpdateProfileRequest } from '@/api/usersApi'
import { reportsApi } from '@/api/reportsApi'
import { formatDate } from '@/utils/format'
import { FileText } from 'lucide-react'

const ACCOUNT_TYPES = ['Savings', 'Current', 'Salary']

// Max edge for the avatar before upload. Legacy compresses client-side too
// — the column is unbounded text but a full-size photo would bloat every
// profile fetch, so the image is downscaled and re-encoded before sending.
const AVATAR_MAX_PX = 256

function downscaleImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not a readable image.'))
      img.onload = () => {
        const scale = Math.min(1, AVATAR_MAX_PX / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Could not process that image.'))
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="font-medium text-gray-900 mt-0.5">{value || '—'}</p>
    </div>
  )
}

function Input({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div>
      <label className="text-xs font-semibold text-gray-600 uppercase block mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue" />
    </div>
  )
}

export default function ProfilePage() {
  const authUser = useAuthStore(s => s.user)
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [pwSuccess, setPwSuccess] = useState(false)
  const [pwError, setPwError] = useState('')

  const [editing, setEditing] = useState<'primary' | 'address' | 'bank' | null>(null)
  const [saveError, setSaveError] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)

  // GET /api/users/profile — the real, full profile record. The page used
  // to read only the JWT payload (name/email/role) and had no way to see or
  // edit phone, photo, address or bank details at all.
  const { data: profile, isLoading } = useQuery({
    queryKey: ['userProfile'],
    queryFn: () => usersApi.getProfile().then(r => r.data.data ?? null),
  })

  // My own performance stats — Vanilla's profile stat cards (Total Applications
  // / Approval Rate / Disbursed / In Process). Reuses the reports summary
  // scoped to just this user (scope=mine), so no new endpoint is needed.
  const { data: myStats } = useQuery({
    queryKey: ['profile-stats'],
    queryFn: () => reportsApi.getSummary({ scope: 'mine' }).then(r => r.data.data),
    staleTime: 120_000,
  })
  const byStatus = myStats?.loansByStatus ?? []
  const cnt = (s: string) => byStatus.find(x => x.status === s)?.count ?? 0
  const totalApps = byStatus.reduce((a, x) => a + (x.count || 0), 0)
  const stDisbursed = cnt('Disbursed')
  const stInProcess = cnt('Submitted') + cnt('UnderReview') + cnt('Approved')
  const stApprovalRate = totalApps ? Math.round(((cnt('Approved') + stDisbursed) / totalApps) * 100) : 0

  const [form, setForm] = useState<UpdateProfileRequest>({})
  useEffect(() => {
    if (!profile) return
    setForm({
      phoneNumber: profile.phoneNumber ?? '',
      addressLine1: profile.addressLine1 ?? '', addressLine2: profile.addressLine2 ?? '',
      addressCity: profile.addressCity ?? '', addressState: profile.addressState ?? '',
      addressPostalCode: profile.addressPostalCode ?? '',
      bankAccountHolderName: profile.bankAccountHolderName ?? '', bankName: profile.bankName ?? '',
      bankAccountType: profile.bankAccountType ?? '', bankAccountNumber: profile.bankAccountNumber ?? '',
      bankIfscCode: profile.bankIfscCode ?? '',
    })
  }, [profile])

  const save = useMutation({
    mutationFn: (data: UpdateProfileRequest) => usersApi.updateProfile(data),
    onSuccess: () => {
      setSaveError(''); setEditing(null); setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2500)
      qc.invalidateQueries({ queryKey: ['userProfile'] })
    },
    onError: (err: unknown) => {
      const d = (err as { response?: { data?: { message?: string; errors?: string[] } } })?.response?.data
      setSaveError(d?.message || d?.errors?.join(' ') || 'Could not save your profile.')
    },
  })

  async function onPickAvatar(file: File) {
    try {
      setSaveError('')
      const photoData = await downscaleImage(file)
      save.mutate({ photoData })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not process that image.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const changePassword = useMutation({
    // BUGFIX (confirmed real, pre-existing bug — Phase 13 audit): called
    // POST /api/auth/change-password, a route that never existed —
    // UsersController.ChangePassword is the real endpoint at
    // POST /api/users/change-password.
    mutationFn: () => api.post<ApiResponse<null>>('/api/users/change-password', pwForm),
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
    if (pwForm.newPassword !== pwForm.confirmPassword) { setPwError('New passwords do not match.'); return }
    if (pwForm.newPassword.length < 6) { setPwError('New password must be at least 6 characters.'); return }
    changePassword.mutate()
  }

  if (!authUser || isLoading) return <PageLoader />

  const p = profile
  const set = (k: keyof UpdateProfileRequest, v: string) => setForm(f => ({ ...f, [k]: v }))

  const EditToggle = ({ section }: { section: 'primary' | 'address' | 'bank' }) => (
    editing === section ? (
      <button onClick={() => { setEditing(null); setSaveError('') }}
        className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1">
        <X size={13} /> Cancel
      </button>
    ) : (
      <button onClick={() => { setEditing(section); setSaveError('') }}
        className="text-xs text-efin-blue hover:underline flex items-center gap-1">
        <Pencil size={13} /> Edit
      </button>
    )
  )

  const SaveBar = () => (
    <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-gray-100">
      <Button size="sm" loading={save.isPending} onClick={() => save.mutate(form)}>Save Changes</Button>
      <Button size="sm" variant="secondary" onClick={() => { setEditing(null); setSaveError('') }}>Cancel</Button>
    </div>
  )

  return (
    <div className="max-w-3xl">
      <PageHeader title="Profile" subtitle="Your account details, preferences and activity" />

      {saveError && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</div>
      )}
      {savedFlash && (
        <div className="mb-4 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-2">
          <CheckCircle size={15} /> Profile updated.
        </div>
      )}

      <div className="space-y-5">
        {/* ── Avatar + identity ── */}
        <Card>
          <div className="flex items-center gap-5">
            <div className="relative shrink-0">
              {p?.photoData ? (
                <img src={p.photoData} alt="Profile" className="w-20 h-20 rounded-full object-cover border border-gray-200" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-efin-blue flex items-center justify-center">
                  <span className="text-white text-2xl font-bold">{authUser.fullName?.[0]?.toUpperCase()}</span>
                </div>
              )}
              <button onClick={() => fileRef.current?.click()} title="Change photo"
                className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-white border border-gray-200 shadow flex items-center justify-center text-gray-500 hover:text-efin-blue">
                <Camera size={13} />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) onPickAvatar(f) }} />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-gray-900 truncate">{p?.fullName ?? authUser.fullName}</p>
              <p className="text-sm text-gray-500 truncate">{p?.email ?? authUser.email}</p>
              <div className="flex flex-wrap gap-2 mt-1.5 text-xs">
                <span className="px-2 py-0.5 rounded-full bg-efin-blue/10 text-efin-blue font-semibold">{p?.role ?? authUser.role}</span>
                {p?.employeeCode && <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-mono">{p.employeeCode}</span>}
                {p?.locationName && <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{p.locationName}</span>}
              </div>
            </div>
          </div>
        </Card>

        {/* ── My performance stats — Vanilla profile stat cards ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total Applications', value: totalApps, accent: 'var(--accent)' },
            { label: 'Approval Rate', value: `${stApprovalRate}%`, accent: 'var(--accent2)' },
            { label: 'Disbursed', value: stDisbursed, accent: 'var(--success)' },
            { label: 'In Process', value: stInProcess, accent: 'var(--warn)' },
          ].map(s => (
            <Card key={s.label}>
              <p className="text-xs font-semibold uppercase" style={{ color: 'var(--text3)', letterSpacing: '.5px' }}>{s.label}</p>
              <p className="text-2xl font-black mt-1" style={{ color: s.accent, fontFamily: 'var(--font-head)' }}>{s.value}</p>
            </Card>
          ))}
        </div>

        {/* ── Primary details ── */}
        <Card>
          <CardHeader title="Primary Details" action={<EditToggle section="primary" />} />
          {editing === 'primary' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Mobile Number" value={form.phoneNumber ?? ''} onChange={v => set('phoneNumber', v)} />
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Name, email and role are managed by an administrator and can't be changed here.
              </p>
              <SaveBar />
            </>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <Field label="Full Name" value={p?.fullName ?? authUser.fullName} />
              <Field label="Email" value={p?.email ?? authUser.email} />
              <Field label="Mobile" value={p?.phoneNumber} />
              <Field label="Role" value={p?.role ?? authUser.role} />
              <Field label="Employee Code" value={p?.employeeCode} />
              <Field label="Member Since" value={p?.createdAt ? formatDate(p.createdAt) : ''} />
              <Field label="Sales Team" value={p?.salesTeam} />
              <Field label="Operation Team" value={p?.opTeam} />
            </div>
          )}
        </Card>

        {/* ── Bank ── (Vanilla profile section order is Primary → Bank →
            Address, index.html:781/798/823 — Bank sits before Address) */}
        <Card>
          <CardHeader title={<><Landmark size={15} className="text-gray-400" /> Bank Details</>} action={<EditToggle section="bank" />} />
          {editing === 'bank' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Account Holder Name" value={form.bankAccountHolderName ?? ''} onChange={v => set('bankAccountHolderName', v)} />
                <Input label="Bank Name" value={form.bankName ?? ''} onChange={v => set('bankName', v)} />
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase block mb-1">Account Type</label>
                  <select value={form.bankAccountType ?? ''} onChange={e => set('bankAccountType', e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">— Select —</option>
                    {ACCOUNT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <Input label="Account Number" value={form.bankAccountNumber ?? ''} onChange={v => set('bankAccountNumber', v)} />
                <Input label="IFSC Code" value={form.bankIfscCode ?? ''} onChange={v => set('bankIfscCode', v.toUpperCase())} />
              </div>
              <SaveBar />
            </>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <Field label="Account Holder" value={p?.bankAccountHolderName} />
              <Field label="Bank Name" value={p?.bankName} />
              <Field label="Account Type" value={p?.bankAccountType} />
              {/* Account number is masked in the read view — it's the one
                  field here that's sensitive if the screen is shoulder-read. */}
              <Field label="Account Number" value={p?.bankAccountNumber ? `••••${p.bankAccountNumber.slice(-4)}` : ''} />
              <Field label="IFSC Code" value={p?.bankIfscCode} />
            </div>
          )}
        </Card>

        {/* ── Address ── */}
        <Card>
          <CardHeader title={<><MapPin size={15} className="text-gray-400" /> Address Details</>} action={<EditToggle section="address" />} />
          {editing === 'address' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Input label="Address Line 1" value={form.addressLine1 ?? ''} onChange={v => set('addressLine1', v)} />
                </div>
                <div className="sm:col-span-2">
                  <Input label="Address Line 2" value={form.addressLine2 ?? ''} onChange={v => set('addressLine2', v)} />
                </div>
                <Input label="City" value={form.addressCity ?? ''} onChange={v => set('addressCity', v)} />
                <Input label="State" value={form.addressState ?? ''} onChange={v => set('addressState', v)} />
                <Input label="Postal Code" value={form.addressPostalCode ?? ''} onChange={v => set('addressPostalCode', v)} />
              </div>
              <SaveBar />
            </>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div className="col-span-2 sm:col-span-3"><Field label="Address" value={[p?.addressLine1, p?.addressLine2].filter(Boolean).join(', ')} /></div>
              <Field label="City" value={p?.addressCity} />
              <Field label="State" value={p?.addressState} />
              <Field label="Postal Code" value={p?.addressPostalCode} />
            </div>
          )}
        </Card>

        {/* ── Documents ── (Vanilla profile Documents section) ── */}
        <Card>
          <CardHeader title={<><FileText size={15} className="text-gray-400" /> Documents</>} />
          <div className="text-center py-8">
            <FileText size={28} className="mx-auto mb-2" style={{ color: 'var(--text3)' }} />
            <p className="text-sm" style={{ color: 'var(--text3)' }}>No documents uploaded</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text3)' }}>Your KYC / profile documents will appear here.</p>
          </div>
        </Card>

        {/* ── Password ── */}
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
                  onChange={e => setPwForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue" />
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
