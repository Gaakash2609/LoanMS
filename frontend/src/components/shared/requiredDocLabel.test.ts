import { describe, it, expect } from 'vitest'
import { requiredDocLabel } from './RequiredDocumentsChecklist'

describe('requiredDocLabel', () => {
  it('maps the known backend document-type keys to friendly labels', () => {
    expect(requiredDocLabel('salary_slip')).toBe('Salary Slips')
    expect(requiredDocLabel('bank_statement')).toBe('Bank Statement')
    expect(requiredDocLabel('itr')).toBe('Form 16 / ITR')
    expect(requiredDocLabel('gst')).toBe('GST Registration')
  })

  it('prettifies an unknown key (snake_case → Title Case) rather than showing raw', () => {
    expect(requiredDocLabel('address_proof')).toBe('Address Proof')
    expect(requiredDocLabel('foo')).toBe('Foo')
  })
})
