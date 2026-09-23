import { useQuery } from '@tanstack/react-query'
import { settingsApi } from '@/api/settingsApi'

// ── Live branding config ────────────────────────────────────────────────────
// The single place the app reads the admin-configured branding (Settings →
// Logo & Branding) from. Every one of these keys is on SettingsController.Get's
// AllowAnonymous public whitelist, so this works for EVERY role — and even
// before login (the sign-in page uses it) — via the generic GET /api/settings/{key}
// route (no Admin-only 403, no bulk Admin-only GET /api/settings needed).
//
// Rendering rule (kept consistent between the real sidebar and the Settings
// preview): an uploaded image OVERRIDES the default MudraHub asset; when no
// image is uploaded the default brand asset is used (never re-typed text); the
// brand name/subtitle only render as text for a genuine rebrand — i.e. when the
// admin changed them from the MudraHub defaults but hasn't uploaded a banner.

export const DEFAULT_BRAND_NAME = 'Mudrahub'
export const DEFAULT_BRAND_SUB = "LET'S MAKE IT HAPPEN"
export const DEFAULT_LOGO_SIZE = 44

export const BRANDING_QUERY_KEY = ['branding'] as const

export interface Branding {
  /** Custom collapsed-rail icon (data URL); '' → use the default monogram. */
  icon: string
  /** Custom expanded wordmark/banner (data URL); '' → default wordmark/text. */
  banner: string
  /** Custom sign-in page logo (data URL); '' → default wordmark. */
  signin: string
  /** Icon size in px (collapsed rail), clamped to something that fits the rail. */
  iconSize: number
  /** Banner height in px (expanded header), clamped to fit the 68px header. */
  bannerSize: number
  /** Brand name — shown as text only when rebranded without a banner image. */
  name: string
  /** Brand subtitle — same rule as name. */
  sub: string
  /** True when name/subtitle differ from the MudraHub defaults (a rebrand). */
  nameCustomized: boolean
  /** Still loading the first time — lets callers avoid a default→custom flash. */
  isLoading: boolean
}

async function keyVal(key: string): Promise<string> {
  try {
    const res = await settingsApi.getByKey(key)
    return res.data.data?.value ?? ''
  } catch {
    return ''
  }
}

// Clamp helpers so a size chosen on the slider (24–72) can never break the
// sidebar layout: the collapsed rail is 64px wide and the header 68px tall.
export const clampIconSize = (n: number) => Math.min(Math.max(n || DEFAULT_LOGO_SIZE, 24), 48)
export const clampBannerSize = (n: number) => Math.min(Math.max(n || DEFAULT_LOGO_SIZE, 24), 52)

export function useBranding(): Branding {
  const { data, isLoading } = useQuery({
    queryKey: BRANDING_QUERY_KEY,
    queryFn: async () => {
      const [icon, banner, iconSize, bannerSize, name, sub, signin] = await Promise.all([
        keyVal('efin_logo'),
        keyVal('efin_banner_logo'),
        keyVal('efin_logo_icon_size'),
        keyVal('efin_logo_banner_size'),
        keyVal('efin_brand_name'),
        keyVal('efin_brand_sub'),
        settingsApi.signinLogo.get().then(r => r.data?.logo ?? '').catch(() => ''),
      ])
      return { icon, banner, iconSize, bannerSize, name, sub, signin }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const rawName = (data?.name ?? '').trim()
  const rawSub = (data?.sub ?? '').trim()

  return {
    icon: data?.icon ?? '',
    banner: data?.banner ?? '',
    signin: data?.signin ?? '',
    iconSize: parseInt(data?.iconSize ?? '') || DEFAULT_LOGO_SIZE,
    bannerSize: parseInt(data?.bannerSize ?? '') || DEFAULT_LOGO_SIZE,
    name: rawName || DEFAULT_BRAND_NAME,
    sub: rawSub || DEFAULT_BRAND_SUB,
    nameCustomized:
      (!!rawName && rawName !== DEFAULT_BRAND_NAME) ||
      (!!rawSub && rawSub !== DEFAULT_BRAND_SUB),
    isLoading,
  }
}
