import React from 'react'
import { cn } from '@/utils/format'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export function Input({ label, error, hint, className, id, ...props }: InputProps) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="space-y-1">
      {/* Label/hint colours come from the legacy text ramp (--text2/--text3)
          rather than Tailwind gray, so they sit on the same scale as the rest
          of the app. */}
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-[color:var(--text2)]"
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={cn('efin-input', error && 'efin-input--error', className)}
        {...props}
      />
      {error && <p className="text-xs text-[color:var(--accent2)]">{error}</p>}
      {hint && !error && <p className="text-xs text-[color:var(--text3)]">{hint}</p>}
    </div>
  )
}
