import { describe, it, expect } from 'vitest'
import { sanitizeNumeric, isPartialNumber, sameNumber, toText } from '@/utils/numericInput'

describe('sanitizeNumeric', () => {
  it('keeps digits and one decimal point', () => {
    expect(sanitizeNumeric('12.5', true)).toBe('12.5')
    expect(sanitizeNumeric('1.2.3', true)).toBe('1.23')
  })
  it('drops letters, spaces, commas and the exponent "e" a native number input allowed', () => {
    expect(sanitizeNumeric('4,99,991', true)).toBe('499991')
    expect(sanitizeNumeric('12abc', true)).toBe('12')
    expect(sanitizeNumeric('1e5', true)).toBe('15')
  })
  it('allows a single leading minus only when negatives are allowed', () => {
    expect(sanitizeNumeric('-5', true)).toBe('-5')
    expect(sanitizeNumeric('5-3', true)).toBe('53')
    expect(sanitizeNumeric('-5', false)).toBe('5')
  })
})

describe('partial values', () => {
  it('treats "-", "." and "-." as not-a-number-yet, like a native number input', () => {
    expect(isPartialNumber('-')).toBe(true)
    expect(isPartialNumber('.')).toBe(true)
    expect(isPartialNumber('')).toBe(false)
    expect(isPartialNumber('12.')).toBe(false)
  })
})

describe('sameNumber (keep what the user is typing)', () => {
  it('does not overwrite "12." or "0.50" when the parent holds the same number', () => {
    expect(sameNumber('12.', '12')).toBe(true)
    expect(sameNumber('0.50', '0.5')).toBe(true)
    expect(sameNumber('2.', '2.0')).toBe(true)
  })
  it('does not fight a lone "-" or "." against an empty parent value', () => {
    expect(sameNumber('-', '')).toBe(true)
    expect(sameNumber('.', '')).toBe(true)
  })
  it('overwrites when the parent moved to a different number', () => {
    expect(sameNumber('12', '13')).toBe(false)
    expect(sameNumber('5', '')).toBe(false)
  })
})

describe('toText', () => {
  it('renders null/undefined as empty and numbers as strings', () => {
    expect(toText(undefined)).toBe('')
    expect(toText(null)).toBe('')
    expect(toText(0)).toBe('0')
    expect(toText(12.5)).toBe('12.5')
  })
})
