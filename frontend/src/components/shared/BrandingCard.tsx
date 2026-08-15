import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Image as ImageIcon, X } from 'lucide-react'
import { settingsApi, type AppSetting } from '@/api/settingsApi'

const DEFAULT_NAME = 'Mudrahub'
const DEFAULT_SUB = "LET'S MAKE IT HAPPEN"
const DEFAULT_SIZE = 44

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function LogoSlot({
  label, value, onUpload, onRemove, uploading,
}: {
  label: string
  value: string
  onUpload: (file: File) => void
  onRemove: () => void
  uploading: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div>
      <label className="text-xs font-medium text-gray-600 block mb-1.5">{label}</label>
      <div className="flex items-center gap-3">
        <div className="w-16 h-16 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
          {value ? <img src={value} alt={label} className="w-full h-full object-contain" /> : <ImageIcon size={20} className="text-gray-300" />}
        </div>
        <div className="flex gap-2">
          <input ref={inputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }} />
          <Button size="sm" variant="secondary" loading={uploading} onClick={() => inputRef.current?.click()}>Upload</Button>
          {value && <Button size="sm" variant="ghost" onClick={onRemove}><X size={13} className="mr-1" />Remove</Button>}
        </div>
      </div>
    </div>
  )
}

// ── Branding panel (Settings → Logo & Branding) ─────────────────────────────
// Mirrors legacy efin-app.js's branding* functions exactly: icon/banner
// logos + sizes + brand name/subtitle are stored via the generic Settings
// API (POST /api/settings with category 'branding'), the sign-in logo via
// its own dedicated endpoint (POST /api/settings/signin-logo) — same split
// as legacy's brandingPushSetting() vs brandingApplySignin(). "Remove" saves
// an empty value (matches brandingRemoveIcon/Banner/Signin, which POST '' —
// there is no DELETE call in the legacy implementation). Values are read
// from the already-loaded Settings list (GET /api/settings, fetched once by
// the parent SettingsPage) rather than a second per-key fetch.
export default function BrandingCard({ settings }: { settings: AppSetting[] }) {
  const qc = useQueryClient()
  const get = (key: string) => settings.find(s => s.key === key)?.value ?? ''

  const [name, setName] = useState(get('efin_brand_name') || DEFAULT_NAME)
  const [sub, setSub] = useState(get('efin_brand_sub') || DEFAULT_SUB)
  const [iconSize, setIconSize] = useState(parseInt(get('efin_logo_icon_size')) || DEFAULT_SIZE)
  const [bannerSize, setBannerSize] = useState(parseInt(get('efin_logo_banner_size')) || DEFAULT_SIZE)

  // Keep local text/size state in sync if the settings list refetches with
  // server-confirmed values (e.g. after a save invalidates the query).
  useEffect(() => { setName(get('efin_brand_name') || DEFAULT_NAME) }, [settings]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSub(get('efin_brand_sub') || DEFAULT_SUB) }, [settings]) // eslint-disable-line react-hooks/exhaustive-deps

  const icon = get('efin_logo')
  const banner = get('efin_banner_logo')
  const signin = get('efin_signin_logo')

  function invalidate() { qc.invalidateQueries({ queryKey: ['settings'] }) }

  const saveSetting = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => settingsApi.update(key, value, 'branding'),
    onSuccess: invalidate,
  })
  const saveSignin = useMutation({
    mutationFn: (logo: string) => settingsApi.signinLogo.set(logo),
    onSuccess: invalidate,
  })

  function uploadIcon(file: File) {
    readAsDataUrl(file).then(dataUrl => saveSetting.mutate({ key: 'efin_logo', value: dataUrl }))
  }
  function uploadBanner(file: File) {
    readAsDataUrl(file).then(dataUrl => saveSetting.mutate({ key: 'efin_banner_logo', value: dataUrl }))
  }
  function uploadSignin(file: File) {
    readAsDataUrl(file).then(dataUrl => saveSignin.mutate(dataUrl))
  }
  function removeIcon() {
    if (!confirm('Remove the icon logo? The default icon will be restored.')) return
    saveSetting.mutate({ key: 'efin_logo', value: '' })
  }
  function removeBanner() {
    if (!confirm('Remove the banner logo? The brand text fallback will be shown.')) return
    saveSetting.mutate({ key: 'efin_banner_logo', value: '' })
  }
  function removeSignin() {
    if (!confirm('Remove the sign-in page logo? The default will be restored.')) return
    saveSignin.mutate('')
  }
  function commitIconSize(size: number) {
    saveSetting.mutate({ key: 'efin_logo_icon_size', value: String(size) })
  }
  function commitBannerSize(size: number) {
    saveSetting.mutate({ key: 'efin_logo_banner_size', value: String(size) })
  }
  function commitName(value: string) {
    saveSetting.mutate({ key: 'efin_brand_name', value })
  }
  function commitSub(value: string) {
    saveSetting.mutate({ key: 'efin_brand_sub', value })
  }
  function resetAll() {
    if (!confirm('Reset ALL branding? Both logos and brand text will be cleared and restored to defaults.')) return
    saveSetting.mutate({ key: 'efin_logo', value: '' })
    saveSetting.mutate({ key: 'efin_banner_logo', value: '' })
    saveSetting.mutate({ key: 'efin_logo_icon_size', value: String(DEFAULT_SIZE) })
    saveSetting.mutate({ key: 'efin_logo_banner_size', value: String(DEFAULT_SIZE) })
    saveSetting.mutate({ key: 'efin_brand_name', value: '' })
    saveSetting.mutate({ key: 'efin_brand_sub', value: '' })
    saveSignin.mutate('')
    setName(DEFAULT_NAME); setSub(DEFAULT_SUB)
    setIconSize(DEFAULT_SIZE); setBannerSize(DEFAULT_SIZE)
  }

  return (
    <Card>
      <CardHeader title="Logo & Branding" subtitle="Sidebar icon, banner, sign-in logo and brand text" />
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <LogoSlot label="Icon Logo" value={icon} uploading={saveSetting.isPending} onUpload={uploadIcon} onRemove={removeIcon} />
          <LogoSlot label="Banner Logo" value={banner} uploading={saveSetting.isPending} onUpload={uploadBanner} onRemove={removeBanner} />
        </div>
        <LogoSlot label="Sign-in Page Logo" value={signin} uploading={saveSignin.isPending} onUpload={uploadSignin} onRemove={removeSignin} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Icon Size ({iconSize}px)</label>
            <input type="range" min={24} max={72} value={iconSize}
              onChange={e => setIconSize(parseInt(e.target.value))}
              onMouseUp={() => commitIconSize(iconSize)}
              onTouchEnd={() => commitIconSize(iconSize)}
              className="w-full" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Banner Size ({bannerSize}px)</label>
            <input type="range" min={24} max={72} value={bannerSize}
              onChange={e => setBannerSize(parseInt(e.target.value))}
              onMouseUp={() => commitBannerSize(bannerSize)}
              onTouchEnd={() => commitBannerSize(bannerSize)}
              className="w-full" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Brand Name</label>
            <input value={name} onChange={e => setName(e.target.value)} onBlur={() => commitName(name)}
              placeholder={DEFAULT_NAME}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Brand Subtitle</label>
            <input value={sub} onChange={e => setSub(e.target.value)} onBlur={() => commitSub(sub)}
              placeholder={DEFAULT_SUB}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <div>
          <Button size="sm" variant="danger" onClick={resetAll}>Reset All Branding</Button>
        </div>
      </div>
    </Card>
  )
}
