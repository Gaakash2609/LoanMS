// ────────────────────────────────────────────────────────────────────────────
// KYC Data Extraction Utilities
// Parses AI-extracted text and returns structured data.
//
// Parity note (Vanilla kyc.js): the legacy KYC step extracts a MIDDLE name from
// the PAN card (kyc-out-mname) and splits the Aadhaar address into "House / Flat
// No." (street1) + "Street & Locality" (street2), then auto-fills those into the
// wizard's address step (kycSyncAddr, efin-app.js/kyc.js:1268-1296). React had
// dropped the middle name and the street1/street2 split (it parsed fullAddress
// but never used it, and never asked the model for the two address lines).
// ────────────────────────────────────────────────────────────────────────────

export interface PanExtractedData {
  firstName: string
  middleName: string
  lastName: string
  fatherName: string
  panNumber: string
}

export interface AadhaarExtractedData {
  aadhaarNumber: string
  fullName: string
  dateOfBirth: string
  gender: string
  street1: string
  street2: string
  city: string
  state: string
  pinCode: string
  fullAddress: string
}

// Value after the first colon on a "Field: Value" line, trimmed. Treats a bare
// dash / "n/a" / "none" as empty so a placeholder answer doesn't fill a field.
function fieldValue(line: string, maxLen = 100): string {
  const m = line.match(/:\s*(.+)/)
  if (!m) return ''
  const v = m[1].trim()
  if (!v || v.length >= maxLen) return ''
  if (/^(—|-|n\/?a|none|not\s+available|nil)$/i.test(v)) return ''
  return v
}

/**
 * Extract PAN card data from AI-extracted text.
 * Looks for first / middle / last / father name patterns and the PAN number.
 */
export function extractPanData(text: string): PanExtractedData {
  const data: PanExtractedData = {
    firstName: '',
    middleName: '',
    lastName: '',
    fatherName: '',
    panNumber: '',
  }

  if (!text) return data

  // PAN number: 5 letters + 4 digits + 1 letter (standard PAN format).
  const panMatch = text.match(/\b([A-Z]{5}[0-9]{4}[A-Z])\b/)
  if (panMatch) data.panNumber = panMatch[1]

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // A single "Name: FULL NAME" line with no explicit first/last split — held
  // back until the end so an explicit "FIRST NAME"/"LAST NAME" line always wins.
  let genericFullName = ''

  // Per-line, most-specific-first (else-if): a "LAST NAME:" line must NOT also
  // be treated as the first name — the previous loose `includes('name')` rule
  // let that happen and clobbered firstName with the surname.
  lines.forEach(line => {
    const lower = line.toLowerCase()
    if (lower.includes('father')) {
      const v = fieldValue(line, 50); if (v) data.fatherName = v
    } else if (lower.includes('first name') || lower.includes('given name')) {
      const v = fieldValue(line, 50); if (v) data.firstName = v
    } else if (lower.includes('middle name')) {
      const v = fieldValue(line, 50); if (v) data.middleName = v
    } else if (lower.includes('last name') || lower.includes('surname') || lower.includes('family name')) {
      const v = fieldValue(line, 50); if (v) data.lastName = v
    } else if (lower.includes('name')) {
      // Generic "Name:" line (no first/last/middle/father qualifier).
      const v = fieldValue(line, 60); if (v && !genericFullName) genericFullName = v
    }
  })

  // Fallback: if the model returned only a combined name, split it the way
  // Vanilla does — word 1 = first, word N = last, the rest = middle
  // (kyc.js:812). Only fills what the explicit lines didn't.
  if (genericFullName && !data.firstName && !data.lastName) {
    const words = genericFullName.split(/\s+/).filter(Boolean)
    if (words.length === 1) {
      data.firstName = words[0]
    } else if (words.length >= 2) {
      data.firstName = words[0]
      data.lastName = words[words.length - 1]
      if (words.length > 2 && !data.middleName) data.middleName = words.slice(1, -1).join(' ')
    }
  }

  return data
}

/**
 * Extract Aadhaar card data from AI-extracted text.
 * Looks for aadhaar number, DOB, gender, and the split address lines.
 */
export function extractAadhaarData(text: string): AadhaarExtractedData {
  const data: AadhaarExtractedData = {
    aadhaarNumber: '',
    fullName: '',
    dateOfBirth: '',
    gender: '',
    street1: '',
    street2: '',
    city: '',
    state: '',
    pinCode: '',
    fullAddress: '',
  }

  if (!text) return data

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // Aadhaar number: 12 digits
  const aadhaarMatch = text.match(/\b(\d{4})\s*(\d{4})\s*(\d{4})\b/)
  if (aadhaarMatch) {
    data.aadhaarNumber = (aadhaarMatch[1] + aadhaarMatch[2] + aadhaarMatch[3]).trim()
  }

  // Per-line, most-specific-first so an address line never lands in `fullName`
  // and "house"/"street" lines don't collide with city/state/pin.
  lines.forEach(line => {
    const lower = line.toLowerCase()

    // DOB patterns: DD/MM/YYYY or DD-MM-YYYY
    if (lower.includes('dob') || lower.includes('birth')) {
      const m = line.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
      if (m) data.dateOfBirth = `${m[1]}/${m[2]}/${m[3]}`
      return
    }
    // Gender
    if (lower.includes('gender') || lower.includes('sex')) {
      const m = line.match(/:\s*(male|female|other)/i)
      if (m) { const v = m[1].trim(); data.gender = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() }
      return
    }
    // Father (skip — Aadhaar has none, but guard so it never becomes the name)
    if (lower.includes('father')) return
    // House / Flat No. → street1
    if (lower.includes('house') || lower.includes('flat') || lower.includes('building') || lower.includes('door')) {
      const v = fieldValue(line, 120); if (v) data.street1 = v
      return
    }
    // Street & Locality / Road / Area → street2
    if (lower.includes('street') || lower.includes('locality') || lower.includes('road') || lower.includes('area') || lower.includes('nagar')) {
      const v = fieldValue(line, 200); if (v) data.street2 = v
      return
    }
    // PIN Code: 6 digits
    if (lower.includes('pin') || lower.includes('postal')) {
      const m = line.match(/(\d{6})/); if (m) data.pinCode = m[1]
      return
    }
    // City / District
    if (lower.includes('city') || lower.includes('district')) {
      const v = fieldValue(line, 100); if (v) data.city = v
      return
    }
    // State
    if (lower.includes('state')) {
      const v = fieldValue(line, 100); if (v) data.state = v
      return
    }
    // Full address (kept for reference; also a source of last resort below)
    if (lower.includes('address')) {
      const m = line.match(/:\s*(.+)/i)
      if (m) { const v = m[1].trim(); if (v.length > 10 && v.length < 500) data.fullAddress = v }
      return
    }
    // Full name (only when not any of the above and not an address line).
    if (lower.includes('full name') || lower.includes('name')) {
      const v = fieldValue(line, 100); if (v && !data.fullName) data.fullName = v
    }
  })

  return data
}
