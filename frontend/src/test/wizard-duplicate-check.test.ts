import { describe, it, expect } from 'vitest'
import { duplicateCheckKey } from '@/pages/wizard/steps/Step1'
import { emptyData } from '@/pages/wizard/wizardTypes'

// The Step-1 duplicate / re-application pre-check is keyed on the SAME
// normalised identifiers the server matches on (PAN trim+upper, mobile digits
// last 10) and on this wizard's own draft id. Step1 fetches under this key and
// NewApplicationPage reads the cached result under it to block Continue — the
// two must agree, and an incomplete PAN/mobile must not be sent at all.
describe('duplicateCheckKey', () => {
  it('normalises PAN and mobile like the server', () => {
    const key = duplicateCheckKey({ ...emptyData, pan: ' abcde1234f ', mobile: '+91 98765-43210' }, 42)
    expect(key).toEqual(['loan-duplicate-check', 'ABCDE1234F', '9876543210', 42])
  })

  it('leaves out incomplete identifiers (autosave mid-typing)', () => {
    const key = duplicateCheckKey({ ...emptyData, pan: 'ABCDE12', mobile: '98765' })
    expect(key).toEqual(['loan-duplicate-check', '', '', 0])
  })

  it('is stable for the same person typed differently', () => {
    const a = duplicateCheckKey({ ...emptyData, pan: 'ABCDE1234F', mobile: '9876543210' }, 7)
    const b = duplicateCheckKey({ ...emptyData, pan: 'abcde1234f', mobile: '098765 43210' }, 7)
    expect(a).toEqual(b)
  })
})
