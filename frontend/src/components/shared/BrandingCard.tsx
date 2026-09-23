import { useEffect, useRef, useState, type DragEvent, type ComponentType, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { InlineLoader } from '@/components/ui/LoadingSpinner'
import { Image as ImageIcon, X, Ruler, Type as TypeIcon, RotateCcw, Palette, PanelLeft } from 'lucide-react'
import { cn } from '@/utils/format'
import { settingsApi, type AppSetting } from '@/api/settingsApi'
import { SidebarBrandIcon, SidebarBrandBanner } from '@/components/ui/BrandLogo'
import { clampIconSize, clampBannerSize, DEFAULT_BRAND_NAME, DEFAULT_BRAND_SUB, DEFAULT_LOGO_SIZE } from '@/hooks/useBranding'

const DEFAULT_NAME = DEFAULT_BRAND_NAME
const DEFAULT_SUB = DEFAULT_BRAND_SUB
const DEFAULT_SIZE = DEFAULT_LOGO_SIZE

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Small uppercase section label with an icon badge — same visual language as
// the app's other grouped-content headers (.section-icon-badge), used here
// to split what used to be one flat list into Logos / Sizing / Brand Text.
function SectionLabel({ icon: Icon, children }: { icon: ComponentType<{ size?: number }>; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="section-icon-badge">
        <Icon size={14} />
      </span>
      <p className="text-[11.5px] font-bold uppercase tracking-wide text-[color:var(--text3)]">{children}</p>
    </div>
  )
}

function LogoSlot({
  label, hint, value, onUpload, onRemove, uploading,
}: {
  label: string
  hint?: string
  value: string
  onUpload: (file: File) => void
  onRemove: () => void
  uploading: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) onUpload(f)
  }

  return (
    <div>
      <label className="text-[13px] font-semibold text-[color:var(--text2)] block mb-2">{label}</label>
      <div className="flex items-center gap-3.5">
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={cn(
            'relative w-[72px] h-[72px] rounded-2xl flex items-center justify-center overflow-hidden shrink-0 transition-colors',
            value
              ? 'border border-[color:var(--border)] bg-[color:var(--surface)]'
              : dragOver
                ? 'border-2 border-dashed border-[color:var(--accent)] bg-[color:var(--accent-subtle)]'
                : 'border-2 border-dashed border-[color:var(--border2)] bg-[color:var(--surface2)]'
          )}
        >
          {uploading ? (
            <InlineLoader size={18} className="text-[color:var(--accent)]" />
          ) : value ? (
            <img src={value} alt={label} className="w-full h-full object-contain p-1.5" />
          ) : (
            <ImageIcon size={20} className="text-[color:var(--border2)]" />
          )}
          {value && !uploading && (
            <button
              onClick={onRemove}
              title={`Remove ${label}`}
              className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white shadow-sm border border-[color:var(--border)] flex items-center justify-center text-gray-400 hover:text-red-600 hover:border-red-200 transition-colors"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <div className="flex flex-col items-start gap-1.5 min-w-0">
          <input ref={inputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }} />
          <Button size="sm" variant="secondary" loading={uploading} onClick={() => inputRef.current?.click()}>
            {value ? 'Replace' : 'Upload'}
          </Button>
          {hint && <p className="text-[11px] text-[color:var(--text3)] leading-snug">{hint}</p>}
        </div>
      </div>
    </div>
  )
}

// Slider paired with a true-to-scale preview square — showing the actual
// logo (or a placeholder) at the exact pixel size being chosen, instead of
// a bare number, so the control shows what it does rather than just saying it.
function SizeSlider({
  label, value, previewSrc, onChange, onCommit, max = 52,
}: {
  label: string
  value: number
  previewSrc: string
  onChange: (v: number) => void
  onCommit: () => void
  max?: number
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-[13px] font-semibold text-[color:var(--text2)]">{label}</label>
        <span className="text-[11px] font-mono font-bold text-[color:var(--accent)] bg-[color:var(--accent-subtle)] px-2 py-0.5 rounded-md">
          {value}px
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="w-[72px] h-[72px] flex items-center justify-center shrink-0">
          <div
            className="rounded-lg bg-[color:var(--surface3)] border border-[color:var(--border)] flex items-center justify-center overflow-hidden transition-[width,height] duration-100"
            style={{ width: value, height: value }}
          >
            {previewSrc
              ? <img src={previewSrc} alt="" className="w-full h-full object-contain" />
              : <ImageIcon size={Math.min(14, value / 3)} className="text-[color:var(--border2)]" />}
          </div>
        </div>
        <input
          type="range" min={24} max={max} value={Math.min(value, max)}
          onChange={e => onChange(parseInt(e.target.value))}
          onMouseUp={onCommit}
          onTouchEnd={onCommit}
          onKeyUp={onCommit}
          className="efin-range flex-1"
        />
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
//
// Visual pass (this revision): grouped into labelled Logos / Sizing / Brand
// Text sections instead of one flat list, a live sidebar-header preview so a
// change's effect is visible before saving, drag-and-drop logo tiles with an
// inline remove control instead of a separate "Remove" button, and the
// on-brand `.efin-range` slider (already used on the loan calculator) instead
// of the unstyled OS default. Native confirm() popups are replaced with the
// app's own inline-confirm pattern (see IncredCredentialsCard) for the one
// truly destructive action (Reset All); removing a single logo is left
// undo-able by re-uploading, so it no longer needs a confirmation step.
export default function BrandingCard({ settings }: { settings: AppSetting[] }) {
  const qc = useQueryClient()
  const get = (key: string) => settings.find(s => s.key === key)?.value ?? ''

  const [name, setName] = useState(get('efin_brand_name') || DEFAULT_NAME)
  const [sub, setSub] = useState(get('efin_brand_sub') || DEFAULT_SUB)
  const [iconSize, setIconSize] = useState(parseInt(get('efin_logo_icon_size')) || DEFAULT_SIZE)
  const [bannerSize, setBannerSize] = useState(parseInt(get('efin_logo_banner_size')) || DEFAULT_SIZE)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  // Keep local text/size state in sync if the settings list refetches with
  // server-confirmed values (e.g. after a save invalidates the query).
  useEffect(() => { setName(get('efin_brand_name') || DEFAULT_NAME) }, [settings]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setSub(get('efin_brand_sub') || DEFAULT_SUB) }, [settings]) // eslint-disable-line react-hooks/exhaustive-deps

  const icon = get('efin_logo')
  const banner = get('efin_banner_logo')
  const signin = get('efin_signin_logo')

  // Show the brand NAME/SUBTITLE as text in the expanded preview only for a
  // genuine rebrand (changed from the MudraHub defaults) — otherwise the real
  // MudraHub wordmark asset renders. Mirrors useBranding.nameCustomized so the
  // preview and the live sidebar agree.
  const previewAsText =
    (name.trim() !== '' && name.trim() !== DEFAULT_NAME) ||
    (sub.trim() !== '' && sub.trim() !== DEFAULT_SUB)

  // Invalidate BOTH the admin Settings list (this page) AND the public
  // ['branding'] query the live sidebar / sign-in page read from, so a saved
  // change takes effect immediately everywhere — this is what makes the
  // controls on this page actually drive the app, not just persist.
  function invalidate() {
    qc.invalidateQueries({ queryKey: ['settings'] })
    qc.invalidateQueries({ queryKey: ['branding'] })
  }
  function flashSaved() { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1800) }

  const saveSetting = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => settingsApi.update(key, value, 'branding'),
    onSuccess: () => { invalidate(); flashSaved() },
  })
  const saveSignin = useMutation({
    mutationFn: (logo: string) => settingsApi.signinLogo.set(logo),
    onSuccess: () => { invalidate(); flashSaved() },
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
  function removeIcon() { saveSetting.mutate({ key: 'efin_logo', value: '' }) }
  function removeBanner() { saveSetting.mutate({ key: 'efin_banner_logo', value: '' }) }
  function removeSignin() { saveSignin.mutate('') }
  function commitIconSize() { saveSetting.mutate({ key: 'efin_logo_icon_size', value: String(iconSize) }) }
  function commitBannerSize() { saveSetting.mutate({ key: 'efin_logo_banner_size', value: String(bannerSize) }) }
  function commitName() { saveSetting.mutate({ key: 'efin_brand_name', value: name }) }
  function commitSub() { saveSetting.mutate({ key: 'efin_brand_sub', value: sub }) }
  function resetAll() {
    saveSetting.mutate({ key: 'efin_logo', value: '' })
    saveSetting.mutate({ key: 'efin_banner_logo', value: '' })
    saveSetting.mutate({ key: 'efin_logo_icon_size', value: String(DEFAULT_SIZE) })
    saveSetting.mutate({ key: 'efin_logo_banner_size', value: String(DEFAULT_SIZE) })
    saveSetting.mutate({ key: 'efin_brand_name', value: '' })
    saveSetting.mutate({ key: 'efin_brand_sub', value: '' })
    saveSignin.mutate('')
    setName(DEFAULT_NAME); setSub(DEFAULT_SUB)
    setIconSize(DEFAULT_SIZE); setBannerSize(DEFAULT_SIZE)
    setConfirmingReset(false)
  }

  return (
    <Card>
      <CardHeader
        title="Logo & Branding"
        subtitle="Sidebar icon, banner, sign-in logo and brand text"
        action={<Palette size={16} className="text-[color:var(--text3)]" />}
      />

      {/* Live preview — renders through the SAME components as the real sidebar
          header (SidebarBrandIcon / SidebarBrandBanner in AppLayout), so what's
          shown here is exactly what these settings produce: an uploaded image
          overrides the default asset, the size sliders drive the rendered size,
          and a rebranded name/subtitle show as text. Reflects unsaved edits
          instantly. Both sidebar states — collapsed rail + expanded header —
          are shown side by side. */}
      <div className="mb-6 rounded-2xl border border-[color:var(--border)] overflow-hidden bg-[linear-gradient(135deg,var(--accent-subtle),var(--surface2))]">
        <div className="flex items-center justify-between px-4 pt-3 pb-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[color:var(--accent)]">
            <PanelLeft size={13} /> Live preview
          </span>
          <span className="text-[10px] font-semibold text-[color:var(--text3)]">exactly as it appears in the sidebar</span>
        </div>
        <div className="flex items-stretch gap-3 px-4 pb-4">
          {/* Collapsed rail (64px) */}
          <div className="shrink-0 rounded-xl bg-[color:var(--surface)] border border-[color:var(--border)] shadow-sm overflow-hidden">
            <div className="w-16 h-[68px] flex items-center justify-center border-b border-[color:var(--border)]">
              <SidebarBrandIcon src={icon} size={clampIconSize(iconSize)} />
            </div>
            <div className="w-16 py-1.5 flex flex-col items-center gap-1.5">
              {[0, 1, 2].map(i => <span key={i} className="w-4 h-1 rounded-full bg-[color:var(--border2)]" />)}
            </div>
          </div>
          {/* Expanded header */}
          <div className="flex-1 min-w-0 rounded-xl bg-[color:var(--surface)] border border-[color:var(--border)] shadow-sm overflow-hidden">
            <div className="h-[68px] flex items-center px-4 border-b border-[color:var(--border)] overflow-hidden">
              <SidebarBrandBanner
                bannerSrc={banner}
                height={clampBannerSize(bannerSize)}
                name={name || DEFAULT_NAME}
                sub={sub || DEFAULT_SUB}
                asText={previewAsText}
              />
            </div>
            <div className="px-4 py-2.5 flex flex-col gap-2">
              {[28, 20, 24].map((w, i) => (
                <span key={i} className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 rounded bg-[color:var(--border2)]" />
                  <span className="h-1.5 rounded-full bg-[color:var(--border2)]" style={{ width: `${w}%` }} />
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-7">
        <section>
          <SectionLabel icon={ImageIcon}>Logos</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
            <LogoSlot
              label="Icon Logo" hint="Square, used in the collapsed sidebar rail."
              value={icon} uploading={saveSetting.isPending} onUpload={uploadIcon} onRemove={removeIcon}
            />
            <LogoSlot
              label="Banner Logo" hint="Wide format, shown alongside the brand name."
              value={banner} uploading={saveSetting.isPending} onUpload={uploadBanner} onRemove={removeBanner}
            />
          </div>
          <LogoSlot
            label="Sign-in Page Logo" hint="Shown above the sign-in form, before login."
            value={signin} uploading={saveSignin.isPending} onUpload={uploadSignin} onRemove={removeSignin}
          />
        </section>

        <section>
          <SectionLabel icon={Ruler}>Sizing</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
            <SizeSlider label="Icon Size" value={iconSize} previewSrc={icon} onChange={setIconSize} onCommit={commitIconSize} max={48} />
            <SizeSlider label="Banner Size" value={bannerSize} previewSrc={banner} onChange={setBannerSize} onCommit={commitBannerSize} max={52} />
          </div>
        </section>

        <section>
          <SectionLabel icon={TypeIcon}>Brand Text</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Input label="Brand Name" value={name} onChange={e => setName(e.target.value)} onBlur={commitName} placeholder={DEFAULT_NAME} />
            <Input label="Brand Subtitle" value={sub} onChange={e => setSub(e.target.value)} onBlur={commitSub} placeholder={DEFAULT_SUB} />
          </div>
        </section>

        <div className="pt-1 border-t border-[color:var(--border)] flex items-center gap-3 flex-wrap">
          {!confirmingReset ? (
            <Button size="sm" variant="danger" onClick={() => setConfirmingReset(true)}>
              <RotateCcw size={14} className="mr-1.5" /> Reset All Branding
            </Button>
          ) : (
            <>
              <span className="text-xs text-[color:var(--text2)]">Reset all logos and brand text to defaults?</span>
              <Button size="sm" variant="danger" onClick={resetAll}>Yes, reset</Button>
              <Button size="sm" variant="secondary" onClick={() => setConfirmingReset(false)}>Cancel</Button>
            </>
          )}
          {savedFlash && <span className="text-xs font-semibold text-[color:var(--success)]">✓ Saved</span>}
        </div>
      </div>
    </Card>
  )
}
