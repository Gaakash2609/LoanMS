// Shared wizard form primitives — extracted verbatim from NewApplicationPage
// .tsx (code-quality refactor, no behaviour change). Used by every Step
// component. FormGroup depends only on lucide's AlertCircle; TextInput and
// SelectInput are self-contained. React namespace types resolve via the
// @types/react UMD global, exactly as in the original file.
import { AlertCircle } from 'lucide-react'

export function FormGroup({ label, required, error, children, action }: {
  label: string; required?: boolean; error?: string; children: React.ReactNode
  // Optional right-aligned control in the label row — used for the KYC "✎ Fix"
  // buttons (Vanilla kycFocusField affordance). Kept optional so every other
  // FormGroup call is unchanged.
  action?: React.ReactNode
}) {
  return (
    <div className="mb-4" data-field-error={error ? 'true' : undefined}>
      <label className="flex items-center justify-between text-xs font-semibold text-gray-600 mb-1">
        <span>{label}{required && <span className="text-red-500 ml-1">*</span>}</span>
        {action}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600 flex items-center gap-1"><AlertCircle size={11} />{error}</p>}
    </div>
  )
}

export function TextInput({
  value, onChange, onBlur, placeholder, type = 'text', inputMode, pattern, maxLength, minLength,
  className = '', digitsOnly, decimalOnly, id, style, readOnly, list,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string
  // Optional <datalist> id — turns the field into a searchable combo (native
  // suggestions) while still allowing free text, e.g. the employer field
  // backed by the lender company master.
  list?: string
  // Optional DOM id so a "✎ Fix" button (KYC step) can focus this field.
  id?: string
  // Fires when the field loses focus — used to mark it "touched" so its
  // real-time validation message becomes visible even if the person never
  // typed anything (e.g. tabbed through a required field and left it blank).
  onBlur?: () => void
  type?: string
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'search' | 'url' | 'none'
  pattern?: string; maxLength?: number; minLength?: number; className?: string
  // Filters what can be typed at all — not just what's flagged as an error
  // afterwards. digitsOnly strips anything but 0-9 (mobile/PIN/Aadhaar/
  // tenure/CIBIL). decimalOnly strips anything but 0-9 and a single decimal
  // point (money/rate fields like salary, EMI obligations, loan amount).
  digitsOnly?: boolean
  decimalOnly?: boolean
  // Optional inline style override — used by the KYC step to tint a field
  // green once its value has come from a successful document extraction.
  style?: React.CSSProperties
  // For fields whose value is synthesized from other fields (e.g. the KYC
  // step's combined "Full Address" preview) rather than editable directly.
  readOnly?: boolean
}) {
  const filter = (raw: string): string => {
    let v = raw
    if (digitsOnly) {
      v = v.replace(/\D/g, '')
    } else if (decimalOnly) {
      v = v.replace(/[^0-9.]/g, '')
      const firstDot = v.indexOf('.')
      if (firstDot !== -1) {
        v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '')
      }
    }
    if (maxLength && v.length > maxLength) v = v.slice(0, maxLength)
    return v
  }
  return (
    <input
      id={id}
      type={type}
      inputMode={inputMode}
      pattern={pattern}
      list={list}
      value={value}
      onChange={e => onChange(filter(e.target.value))}
      onBlur={onBlur}
      placeholder={placeholder}
      maxLength={maxLength}
      minLength={minLength}
      readOnly={readOnly}
      style={style}
      className={`w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue focus:border-transparent ${readOnly ? 'cursor-default' : ''} ${className}`}
    />
  )
}

export function SelectInput({ value, onChange, onBlur, options, placeholder, id, style }: {
  value: string; onChange: (v: string) => void
  // See TextInput.onBlur — same purpose for dropdowns (e.g. a required
  // Location/State select the person opened and left on the placeholder).
  onBlur?: () => void
  options: Array<{ value: string; label: string } | string>; placeholder?: string
  // Optional DOM id so a "✎ Fix" button (KYC step) can focus this field.
  id?: string
  // See TextInput.style — used by the KYC step's green "extracted" tint.
  style?: React.CSSProperties
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onBlur}
      style={style}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue bg-white"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(opt => {
        const v = typeof opt === 'string' ? opt : opt.value
        const l = typeof opt === 'string' ? opt : opt.label
        return <option key={v} value={v}>{l}</option>
      })}
    </select>
  )
}
