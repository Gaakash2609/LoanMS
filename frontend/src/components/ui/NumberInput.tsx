import React, { useEffect, useState } from 'react'
import { toText, sanitizeNumeric, isPartialNumber, sameNumber } from '@/utils/numericInput'

// A numbers-only text field. It replaces the browser's native number input,
// which draws the up/down stepper arrows that are fiddly to hit and easy to
// nudge by accident. There is no stepper here at all — this is a plain text
// input (numeric keypad on phones) that only lets digits, one decimal point and
// an optional leading minus through.
//
// Drop-in for the old <input type="number">: same props, same onChange event
// (e.target.value is always the cleaned text, or '' while the text is only a
// partial like "-" or "."), controlled via `value` or uncontrolled via
// `defaultValue`. `min`/`max`/`step` are accepted so call sites stay unchanged;
// only `min` is used (a min of 0 or more means no minus sign is allowed).
type NumberInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'min' | 'max' | 'step'> & {
  min?: number | string
  max?: number | string
  step?: number | string
}

export const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { min, max: _max, step: _step, value, defaultValue, onChange, ...rest },
  ref,
) {
  const allowNegative = min === undefined || Number(min) < 0
  const controlled = value !== undefined
  const [text, setText] = useState<string>(() => toText(controlled ? value : defaultValue))

  useEffect(() => {
    if (!controlled) return
    const incoming = toText(value)
    setText(current => (sameNumber(current, incoming) ? current : incoming))
  }, [value, controlled])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const clean = sanitizeNumeric(e.target.value, allowNegative)
    setText(clean)
    // Hand the caller the number-ish value; the box itself keeps showing `clean`.
    e.target.value = isPartialNumber(clean) ? '' : clean
    onChange?.(e)
  }

  return (
    <input
      autoComplete="off"
      {...rest}
      ref={ref}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={handleChange}
    />
  )
})
