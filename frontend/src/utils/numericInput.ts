export const toText = (v: unknown): string => (v === undefined || v === null ? '' : String(v))

export function sanitizeNumeric(raw: string, allowNegative: boolean): string {
  let s = raw.replace(/[^\d.-]/g, '')
  const negative = allowNegative && s.startsWith('-')
  s = s.replace(/-/g, '')
  const dot = s.indexOf('.')
  if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '')
  return (negative ? '-' : '') + s
}

// "-", "." and "-." are not numbers yet; a native number input reports '' for them.
export const isPartialNumber = (s: string) => s !== '' && !Number.isFinite(Number(s))

// Same rule React applies to a native number input: keep what the user is
// typing ("12.", "0.50") while it still means the same number as the parent's
// value, and only overwrite it when the parent has really moved to another one.
export function sameNumber(typed: string, incoming: string): boolean {
  const t = isPartialNumber(typed) ? '' : typed
  const i = isPartialNumber(incoming) ? '' : incoming
  if (t === i) return true
  return t !== '' && i !== '' && Number(t) === Number(i)
}
