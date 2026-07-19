// ────────────────────────────────────────────────────────────────────────────
// KYC Data Extraction Utilities
// Parses AI-extracted text and returns structured data
// ────────────────────────────────────────────────────────────────────────────

export interface PanExtractedData {
  firstName: string
  lastName: string
  fatherName: string
}

export interface AadhaarExtractedData {
  aadhaarNumber: string
  dateOfBirth: string
  gender: string
  city: string
  state: string
  pinCode: string
  fullAddress: string
}

/**
 * Extract PAN card data from AI-extracted text.
 * Looks for name, father name patterns in the text.
 */
export function extractPanData(text: string): PanExtractedData {
  const data: PanExtractedData = {
    firstName: '',
    lastName: '',
    fatherName: '',
  }

  if (!text) return data

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // Try to find structured data in format: "Field: Value"
  lines.forEach(line => {
    const lower = line.toLowerCase()

    if (
      lower.includes('first name') ||
      lower.includes('given name') ||
      lower.includes('name') && !lower.includes('father')
    ) {
      const match = line.match(/:\s*(.+)/i)
      if (match) {
        const val = match[1].trim()
        if (val.length < 50) data.firstName = val
      }
    }

    if (
      lower.includes('last name') ||
      lower.includes('surname') ||
      lower.includes('family name')
    ) {
      const match = line.match(/:\s*(.+)/i)
      if (match) {
        const val = match[1].trim()
        if (val.length < 50) data.lastName = val
      }
    }

    if (lower.includes('father')) {
      const match = line.match(/:\s*(.+)/i)
      if (match) {
        const val = match[1].trim()
        if (val.length < 50) data.fatherName = val
      }
    }
  })

  return data
}

/**
 * Extract Aadhaar card data from AI-extracted text.
 * Looks for aadhaar number, DOB, gender, address patterns.
 */
export function extractAadhaarData(text: string): AadhaarExtractedData {
  const data: AadhaarExtractedData = {
    aadhaarNumber: '',
    dateOfBirth: '',
    gender: '',
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

  lines.forEach(line => {
    const lower = line.toLowerCase()

    // DOB patterns: DD/MM/YYYY or DD-MM-YYYY
    if (lower.includes('dob') || lower.includes('birth')) {
      const match = line.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/)
      if (match) {
        data.dateOfBirth = `${match[1]}/${match[2]}/${match[3]}`
      }
    }

    // Gender
    if (lower.includes('gender') || lower.includes('sex')) {
      const match = line.match(/:\s*(male|female|other)/i)
      if (match) {
        const val = match[1].trim()
        data.gender = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase()
      }
    }

    // City / District
    if (
      lower.includes('city') ||
      lower.includes('district')
    ) {
      const match = line.match(/:\s*(.+)/i)
      if (match) {
        const val = match[1].trim()
        if (val.length < 100) data.city = val
      }
    }

    // State
    if (lower.includes('state')) {
      const match = line.match(/:\s*(.+)/i)
      if (match) {
        const val = match[1].trim()
        if (val.length < 100) data.state = val
      }
    }

    // PIN Code: 6 digits
    if (lower.includes('pin') || lower.includes('postal')) {
      const match = line.match(/(\d{6})/)
      if (match) {
        data.pinCode = match[1]
      }
    }

    // Full address
    if (lower.includes('address')) {
      const match = line.match(/:\s*(.+)/i)
      if (match) {
        const val = match[1].trim()
        if (val.length > 10 && val.length < 500) data.fullAddress = val
      }
    }
  })

  return data
}
