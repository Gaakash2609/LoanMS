import { describe, it, expect } from 'vitest'
import { extractPanData, extractAadhaarData } from '@/utils/kycExtraction'

// Locks the Vanilla-parity behaviour restored on 2026-09-12: PAN middle-name
// extraction, the Aadhaar street1/street2 split, and the fix for a parser bug
// where a "LAST NAME:" line clobbered firstName (loose `includes('name')`).

describe('extractPanData', () => {
  it('parses first / middle / last / father separately without clobbering', () => {
    const d = extractPanData(
      'FIRST NAME: Rahul\nMIDDLE NAME: Kumar\nLAST NAME: Sharma\nFATHER\'S NAME: Suresh Sharma\nPAN NUMBER: ABCDE1234F'
    )
    expect(d.firstName).toBe('Rahul')
    expect(d.middleName).toBe('Kumar')
    expect(d.lastName).toBe('Sharma')          // must NOT leak into firstName
    expect(d.fatherName).toBe('Suresh Sharma')
    expect(d.panNumber).toBe('ABCDE1234F')
  })

  it('firstName is not overwritten by the last-name line (regression)', () => {
    const d = extractPanData('FIRST NAME: Rahul\nLAST NAME: Sharma')
    expect(d.firstName).toBe('Rahul')
    expect(d.lastName).toBe('Sharma')
  })

  it('splits a single combined Name line the Vanilla way (first / middle / last)', () => {
    const d = extractPanData('NAME: Rahul Kumar Sharma\nPAN NUMBER: ABCDE1234F')
    expect(d.firstName).toBe('Rahul')
    expect(d.middleName).toBe('Kumar')
    expect(d.lastName).toBe('Sharma')
  })

  it('treats a dash / blank middle name as empty', () => {
    const d = extractPanData('FIRST NAME: Rahul\nMIDDLE NAME: —\nLAST NAME: Sharma')
    expect(d.middleName).toBe('')
  })
})

describe('extractAadhaarData', () => {
  it('splits the address into street1 (house/flat) and street2 (street/locality)', () => {
    const d = extractAadhaarData(
      'FULL NAME: Rahul Sharma\nAADHAAR NUMBER: 1234 5678 9012\nDATE OF BIRTH: 15/05/1990\nGENDER: Male\n' +
      'HOUSE/FLAT NO: Flat 501, 4th Floor\nSTREET/LOCALITY: MG Road, Andheri West\nCITY: Mumbai\nSTATE: Maharashtra\nPIN CODE: 400058'
    )
    expect(d.aadhaarNumber).toBe('123456789012')
    expect(d.fullName).toBe('Rahul Sharma')
    expect(d.dateOfBirth).toBe('15/05/1990')
    expect(d.gender).toBe('Male')
    expect(d.street1).toBe('Flat 501, 4th Floor')
    expect(d.street2).toBe('MG Road, Andheri West')
    expect(d.city).toBe('Mumbai')
    expect(d.state).toBe('Maharashtra')
    expect(d.pinCode).toBe('400058')
  })

  it('an address line never lands in fullName', () => {
    const d = extractAadhaarData('FULL NAME: Rahul Sharma\nSTREET/LOCALITY: Station Road')
    expect(d.fullName).toBe('Rahul Sharma')
    expect(d.street2).toBe('Station Road')
  })
})
