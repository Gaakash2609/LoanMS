// Bank Statement Account Details Extraction

export interface AccountDetailsExtracted {
  accountHolder: string
  bank: string
  accountNumber: string
  accountType: string
  ifsc: string
  branch: string
  pan: string
  mobile: string
}

export function extractAccountDetails(text: string): AccountDetailsExtracted {
  const data: AccountDetailsExtracted = {
    accountHolder: '',
    bank: '',
    accountNumber: '',
    accountType: '',
    ifsc: '',
    branch: '',
    pan: '',
    mobile: '',
  }

  if (!text) return data

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  lines.forEach(line => {
    const lower = line.toLowerCase()

    // Account Holder / Customer Name
    if (
      lower.includes('account holder') ||
      lower.includes('customer name') ||
      lower.includes('name') && !lower.includes('bank')
    ) {
      const match = line.match(/:\s*(.+)/i)
      if (match) {
        const val = match[1].trim()
        if (val.length < 100 && !val.includes(':')) data.accountHolder = val
      }
    }

    // Bank Name
    if (lower.includes('bank')) {
      const match = line.match(/:\s*(.+)/i)
      if (match) {
        const val = match[1].trim()
        if (val.length < 50) data.bank = val
      }
    }

    // Account Number (multiple formats: 1234567890, 1234 5678 9012)
    if (lower.includes('account') && lower.includes('number')) {
      const match = line.match(/(\d{10,18})/);
      if (match) {
        data.accountNumber = match[1].replace(/\s/g, '')
      }
    }

    // Account Type (Savings, Current, etc.)
    if (lower.includes('account type') || lower.includes('account') && lower.includes('type')) {
      const match = line.match(/:\s*(.+)/i)
      if (match) {
        const val = match[1].trim()
        if (['savings', 'current', 'checking', 'salary'].some(t => val.toLowerCase().includes(t))) {
          data.accountType = val
        }
      }
    }

    // IFSC Code (11 characters)
    if (lower.includes('ifsc')) {
      const match = line.match(/([A-Z]{4}0[A-Z0-9]{6})/)
      if (match) {
        data.ifsc = match[1]
      }
    }

    // Branch
    if (lower.includes('branch')) {
      const match = line.match(/:\s*(.+)/i)
      if (match) {
        const val = match[1].trim()
        if (val.length < 100) data.branch = val
      }
    }

    // PAN (10 character format)
    if (lower.includes('pan')) {
      const match = line.match(/([A-Z]{5}[0-9]{4}[A-Z])/)
      if (match) {
        data.pan = match[1]
      }
    }

    // Mobile Number (10 digits)
    if (lower.includes('mobile') || lower.includes('phone')) {
      const match = line.match(/(\d{10})/)
      if (match) {
        data.mobile = match[1]
      }
    }
  })

  return data
}
