import type { AccountInfo, Transaction, TxnType } from './types'
import { categorize } from './categorizer'

// ── parseIndianDate ───────────────────────────────────────────────────────
// Ported unchanged from perfios-core.js:1312-1401. Same pattern order, same
// strict day/month validation (rejects JS Date auto-correction of invalid
// dates like 31 Feb), same DD/MM/YYYY-first assumption (Indian banks never
// use MM/DD/YYYY).
export function parseIndianDate(str: string): Date | null {
  if (!str) return null
  str = str.trim()
  let m: RegExpMatchArray | null

  const mon: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    january: 0, february: 1, march: 2, april: 3, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/)
  if (m) {
    const day = +m[1], month = +m[2], year = +m[3]
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(year, month - 1, day)
      if (d.getDate() === day && d.getMonth() === month - 1 && d.getFullYear() === year) return d
    }
    return null
  }

  // DD/MM/YY or DD-MM-YY (short year)
  m = str.match(/^(\d{2})[-/.](\d{2})[-/.](\d{2})$/)
  if (m) {
    const day = +m[1], month = +m[2], yr2 = +m[3]
    const year = yr2 <= 35 ? 2000 + yr2 : 1900 + yr2
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(year, month - 1, day)
      if (d.getDate() === day && d.getMonth() === month - 1) return d
    }
    return null
  }

  // YYYY/MM/DD or YYYY-MM-DD or YYYY.MM.DD (ISO, DBS, HSBC, neo-banks)
  m = str.match(/^(\d{4})[-/.](\d{2})[-/.](\d{2})$/)
  if (m) {
    const year = +m[1], month = +m[2], day = +m[3]
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day)
      if (d.getDate() === day && d.getMonth() === month - 1) return d
    }
    return null
  }

  // DD Mon YYYY (e.g. "30 Mar 2026", "5 January 2025")
  m = str.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/i)
  if (m) {
    const mk = m[2].toLowerCase().slice(0, 3)
    const moIdx = mon[m[2].toLowerCase()] !== undefined ? mon[m[2].toLowerCase()] : mon[mk]
    if (moIdx !== undefined) {
      const d = new Date(+m[3], moIdx, +m[1])
      if (d.getDate() === +m[1] && d.getMonth() === moIdx) return d
    }
    return null
  }

  // DD-Mon-YYYY (e.g. "30-Mar-2026")
  m = str.match(/^(\d{1,2})[-/]([A-Za-z]{3,9})[-/](\d{4})$/i)
  if (m) {
    const mk = m[2].toLowerCase().slice(0, 3)
    const moIdx = mon[m[2].toLowerCase()] !== undefined ? mon[m[2].toLowerCase()] : mon[mk]
    if (moIdx !== undefined) {
      const d = new Date(+m[3], moIdx, +m[1])
      if (d.getDate() === +m[1] && d.getMonth() === moIdx) return d
    }
    return null
  }

  // DDMonYYYY compact (e.g. "30Mar2026") — some co-op banks
  m = str.match(/^(\d{2})([A-Za-z]{3})(\d{4})$/i)
  if (m) {
    const moIdx = mon[m[2].toLowerCase()]
    if (moIdx !== undefined) {
      const d = new Date(+m[3], moIdx, +m[1])
      if (d.getDate() === +m[1] && d.getMonth() === moIdx) return d
    }
    return null
  }

  return null
}

// ── extractAccountInfo ────────────────────────────────────────────────────
// Ported unchanged from perfios-core.js:785-962. Mutates and returns the
// passed-in AccountInfo object (matching legacy's cross-file accumulation:
// each field is only ever filled once, first file to find it wins — same
// `if (!accountInfo.bank)` guard pattern throughout).
const KNOWN_BANKS = [
  'State Bank of India', 'SBI', 'Punjab National Bank', 'PNB',
  'Bank of Baroda', 'Bank of India', 'Canara Bank', 'Union Bank of India',
  'Central Bank of India', 'Indian Bank', 'Indian Overseas Bank', 'UCO Bank',
  'Bank of Maharashtra', 'Punjab & Sind Bank',
  'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank', 'Yes Bank',
  'IDFC FIRST Bank', 'IndusInd Bank', 'Federal Bank', 'South Indian Bank',
  'Karur Vysya Bank', 'Lakshmi Vilas Bank', 'Dhanlaxmi Bank',
  'City Union Bank', 'Tamilnad Mercantile Bank', 'Nainital Bank',
  'RBL Bank', 'DCB Bank', 'Bandhan Bank', 'CSB Bank', 'Jammu & Kashmir Bank',
  'AU Small Finance Bank', 'Jana Small Finance Bank', 'Equitas Small Finance Bank',
  'Ujjivan Small Finance Bank', 'ESAF Small Finance Bank', 'Utkarsh Small Finance Bank',
  'Suryoday Small Finance Bank', 'Capital Small Finance Bank', 'FINCARE Small Finance Bank',
  'North East Small Finance Bank',
  'Paytm Payments Bank', 'Airtel Payments Bank', 'FINO Payments Bank',
  'India Post Payments Bank', 'Jio Payments Bank', 'NSDL Payments Bank',
  'DBS Bank India', 'HSBC India', 'Citibank', 'Standard Chartered Bank',
  'Deutsche Bank', 'Barclays Bank', 'BNP Paribas',
  'Saraswat Co-operative Bank', 'Saraswat Bank', 'TJSB Sahakari Bank', 'SVC Bank',
  'Cosmos Co-operative Bank', 'Shamrao Vithal Co-operative Bank', 'The Kalyan Janata',
  'Navi Mumbai Cooperative', 'Abhyudaya Cooperative Bank', 'Bassein Catholic Bank',
  'Bharat Co-operative Bank', 'Zoroastrian Co-operative Bank',
  'The Thane Bharat Sahakari Bank', 'Mahanagar Co-operative Bank',
  'NKGSB Cooperative Bank', 'Rajkot Nagarik Sahakari Bank',
]

const IFSC_BANK_MAP: Record<string, string> = {
  HDFC: 'HDFC Bank', ICIC: 'ICICI Bank', UTIB: 'Axis Bank', KKBK: 'Kotak Mahindra Bank',
  YESB: 'Yes Bank', IDFB: 'IDFC FIRST Bank', INDB: 'IndusInd Bank', FDRL: 'Federal Bank',
  SIBL: 'South Indian Bank', KVBL: 'Karur Vysya Bank', RATN: 'RBL Bank', DCBL: 'DCB Bank',
  BDBL: 'Bandhan Bank', AUBL: 'AU Small Finance Bank', JSFB: 'Jana Small Finance Bank',
  ESFB: 'Equitas Small Finance Bank', USFB: 'Ujjivan Small Finance Bank',
  SBIN: 'State Bank of India', PUNB: 'Punjab National Bank', BKID: 'Bank of India',
  BARB: 'Bank of Baroda', CNRB: 'Canara Bank', UBIN: 'Union Bank of India',
  CBIN: 'Central Bank of India', IDIB: 'Indian Bank', IOBA: 'Indian Overseas Bank',
  UCBA: 'UCO Bank', MAHB: 'Bank of Maharashtra', PSIB: 'Punjab & Sind Bank',
  DBSS: 'DBS Bank India', HSBC: 'HSBC India', CITI: 'Citibank', SCBL: 'Standard Chartered',
  PYTM: 'Paytm Payments Bank', AIRP: 'Airtel Payments Bank', FINO: 'FINO Payments Bank',
  NSDL: 'NSDL Payments Bank', IIPP: 'India Post Payments Bank',
}

export function extractAccountInfo(text: string, accountInfo: AccountInfo = {}): AccountInfo {
  const lines = text.split(/\n/).map(l => l.trim())
  const full = text.replace(/\n/g, ' ')

  for (const line of lines) {
    if (!accountInfo.bank) {
      for (const kb of KNOWN_BANKS) {
        if (new RegExp(kb.replace(/[()]/g, '\\$&'), 'i').test(line)) { accountInfo.bank = kb; break }
      }
    }
    if (!accountInfo.bank) {
      const m = line.match(/(?:Bank(?:\s*Name)?|Institution|Issued\s*by)[:\-\s]+([A-Za-z][A-Za-z\s,.]+(?:Bank|Financial|Finance|Cooperative|Co-op)[A-Za-z,.\s]*)/i)
      if (m) accountInfo.bank = m[1].trim().replace(/\s+/g, ' ').slice(0, 60)
    }

    if (!accountInfo.accountNo) {
      const m = line.match(/(?:A\/C\s*(?:No\.?|Num(?:ber)?)?|Account\s*(?:No\.?|Num(?:ber)?)|Acct\.?\s*(?:No\.?|Num)?|SB\s*A\/C|CA\s*A\/C|OD\s*A\/C|CC\s*A\/C|NRE\s*A\/C|NRO\s*A\/C|FCNR\s*A\/C)[\s:\-]*([0-9Xx]{6,20})/i)
      if (m) accountInfo.accountNo = m[1].replace(/[Xx]/g, 'x').trim()
    }

    if (!accountInfo.ifsc) {
      const m = line.match(/(?:IFSC|IFS\s*Code|Branch\s*Code)[\s:\-]*([A-Z]{4}0[A-Z0-9]{6})/i)
      if (m) accountInfo.ifsc = m[1].toUpperCase()
    }

    if (!accountInfo.micr) {
      const m = line.match(/(?:MICR|MICR\s*Code)[\s:\-]*([0-9]{9})/i)
      if (m) accountInfo.micr = m[1]
    }

    if (!accountInfo.accountType) {
      const m = line.match(/(?:Account\s*Type|A\/C\s*Type|Type\s*of\s*Account)[\s:\-]+(Savings|Current|Overdraft|Cash\s*Credit|NRE|NRO|FCNR|Recurring|Fixed\s*Deposit)[A-Za-z\s]*/i)
      if (m) accountInfo.accountType = m[1].trim()
      else if (/\b(Savings\s*Account|SB\s*Account|Regular\s*Savings)\b/i.test(line)) accountInfo.accountType = 'Savings'
      else if (/\b(Current\s*Account|CA\b)\b/i.test(line)) accountInfo.accountType = 'Current'
    }

    if (!accountInfo.branch) {
      const m = line.match(/(?:Branch\s*(?:Name)?|Home\s*Branch)[\s:\-]+([A-Za-z][A-Za-z\s,\-.]{3,60})/i)
      if (m) accountInfo.branch = m[1].trim().replace(/\s+/g, ' ').slice(0, 60)
    }

    if (!accountInfo.name) {
      const m = line.match(/(?:Account\s*Holder(?:\s*Name)?|Name\s*(?:of\s*Account\s*Holder)?|Customer\s*Name|Applicant\s*Name|Member\s*Name|Proprietor\s*Name)[:\s]+([A-Z][A-Za-z\s.]{3,60})/)
      if (m) accountInfo.name = m[1].trim().replace(/\s+/g, ' ')
    }
    if (!accountInfo.name) {
      const m = line.match(/^([A-Z][A-Z\s.]{3,60})\s+Your\s*Base\s*Branch\s*:/)
      if (m) accountInfo.name = m[1].trim().replace(/\s+/g, ' ')
    }

    if (!accountInfo.mobile) {
      const m = line.match(/(?:Mobile|Phone|Contact|Tel(?:ephone)?)[\s:\-.]*(?:\+91[-\s]?)?([6-9][0-9]{9})/i)
      if (m) accountInfo.mobile = m[1]
    }

    if (!accountInfo.email) {
      const m = line.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
      if (m) accountInfo.email = m[1]
    }

    if (!accountInfo.pan) {
      const m = line.match(/(?:PAN|Permanent\s*Account\s*Number)[\s:\-]*([A-Z]{5}[0-9]{4}[A-Z])/i)
      if (m) accountInfo.pan = m[1].toUpperCase()
    }

    if (!accountInfo.address) {
      const m = line.match(/(?:Address|Registered\s*Address|Mailing\s*Address|Communication\s*Address)[\s:\-]+(.{15,120})/i)
      if (m) accountInfo.address = m[1].trim().replace(/\s+/g, ' ')
    }

    if (!accountInfo.cif) {
      const m = line.match(/(?:CIF\s*(?:No\.?|ID)?|Customer\s*ID|Cust(?:omer)?\s*(?:No\.?|ID))[\s:\-]*([A-Z0-9]{5,16})/i)
      if (m) accountInfo.cif = m[1].trim()
    }

    if (!accountInfo.periodFrom) {
      const m = line.match(/(?:From|Statement\s*From|Period\s*From)[\s:\-]+(\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4})/i)
      if (m) accountInfo.periodFrom = m[1].trim()
    }
    if (!accountInfo.periodTo) {
      const m = line.match(/(?:To|Statement\s*To|Period\s*To)[\s:\-]+(\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4})/i)
      if (m) accountInfo.periodTo = m[1].trim()
    }
  }

  if (!accountInfo.mobile) {
    const m = full.match(/(?:^|[\s,;:(])(?:\+91[-\s]?|91[-\s])?([6-9][0-9]{9})(?:[\s,;:)]|$)/)
    if (m) accountInfo.mobile = m[1]
  }
  if (!accountInfo.accountNo) {
    const m = full.match(/\b([0-9]{9,18})\b/)
    if (m) accountInfo.accountNo = m[1]
  }
  if (!accountInfo.bank && accountInfo.ifsc) {
    const prefix = accountInfo.ifsc.slice(0, 4)
    if (IFSC_BANK_MAP[prefix]) accountInfo.bank = IFSC_BANK_MAP[prefix]
  }

  return accountInfo
}

// ── parseTransactions ─────────────────────────────────────────────────────
// Ported unchanged from perfios-core.js:964-1279 ("Universal Transaction
// Parser v7.0"). `log` is an optional callback replacing legacy's direct
// calls to the global `log(type, msg)` UI function — same call sites, same
// messages; passing no logger simply skips the diagnostic output.
type LogFn = (type: string, msg: string) => void

const SKIP_LINE_PATTERNS: RegExp[] = [
  /statement\s*(period|date|from|to)/i,
  /opening\s*balance/i,
  /closing\s*balance/i,
  /account\s*(summary|statement|period|detail)/i,
  /from\s*date|to\s*date/i,
  /^date\s+(narration|description|particulars|txn|transaction|value)/i,
  /^\s*(date|sl\.?\s*no|sr\.?\s*no|sno\.?|#|s\.no)\s*$/i,
  /page\s*\d+\s*(of\s*\d+)?/i,
  /generated\s*on|print\s*date|print\s*time/i,
  /total\s*(debit|credit|balance|transactions?)/i,
  /^opening\s*balance\s*total/i,
  /brought\s*forward/i,
  /carried\s*forward/i,
  /transaction\s*summary/i,
  /mini\s*statement/i,
  /^(transaction\s*)?date\s+(chq|cheque|ref|value)/i,
  /^narration\s+chq/i,
  /authorized\s*signatory/i,
  /this\s*is\s*(a\s*)?computer\s*generated/i,
  /for\s*(and\s*on\s*behalf|the\s*bank)/i,
  /e-statement|internet\s*banking/i,
  /^\s*(?:debit|credit|withdrawal|deposit|dr|cr|balance)\s*$/i,
  /balance\s+brought\s+forward/i,
]

const DATE_PATTERNS: RegExp[] = [
  /(\d{1,2}[-/]\d{1,2}[-/]\d{4})/,
  /(\d{4}[-/]\d{2}[-/]\d{2})/,
  /(\d{2}[-/]\d{2}[-/]\d{2})/,
  /(\d{2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/i,
  /(\d{1,2}[-/](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[-/]\d{4})/i,
  /(\d{2}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\d{4})/i,
  /(\d{2}\.\d{2}\.\d{4})/,
  /(\d{4}\.\d{2}\.\d{2})/,
  /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i,
]

function stripDates(s: string): string {
  return s
    .replace(/\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/gi, '')
    .replace(/\d{1,2}[-/](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[-/]\d{4}/gi, '')
    .replace(/\d{2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/gi, '')
    .replace(/\d{2}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\d{4}/gi, '')
    .replace(/\d{4}[-/.]\d{2}[-/.]\d{2}/g, '')
    .replace(/\d{1,2}[-/.]\d{1,2}[-/.]\d{4}/g, '')
    .replace(/\d{2}[-/.]\d{2}[-/.]\d{2}/g, '')
}

function lineHasDate(l: string): boolean {
  for (const pat of DATE_PATTERNS) {
    const m = pat.exec(l)
    if (m) {
      const d = parseIndianDate(m[1])
      if (d && d.getFullYear() >= 2010 && d.getFullYear() <= 2035) return true
    }
  }
  return false
}

export function parseTransactions(text: string, filename: string, log?: LogFn): Transaction[] {
  const txns: Transaction[] = []
  log?.('info', `  📄 Extracted text preview: ${text.slice(0, 300).replace(/\n/g, ' ↵ ')}`)
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean)
  log?.('info', `  📄 Total lines extracted: ${lines.length}`)

  const bankHint = (() => {
    const s = (filename + ' ' + text.slice(0, 2000)).toLowerCase()
    if (/hdfc/i.test(s)) return 'HDFC'
    if (/icici/i.test(s)) return 'ICICI'
    if (/axis/i.test(s)) return 'AXIS'
    if (/kotak/i.test(s)) return 'KOTAK'
    if (/sbi|state bank/i.test(s)) return 'SBI'
    if (/pnb|punjab national/i.test(s)) return 'PNB'
    if (/bob|bank of baroda/i.test(s)) return 'BOB'
    if (/canara/i.test(s)) return 'CANARA'
    if (/union bank/i.test(s)) return 'UNION'
    if (/central bank/i.test(s)) return 'CENTRAL'
    if (/indian bank/i.test(s)) return 'INDIANBANK'
    if (/indian overseas/i.test(s)) return 'IOB'
    if (/uco bank/i.test(s)) return 'UCO'
    if (/bank of india/i.test(s)) return 'BOI'
    if (/bank of maharashtra/i.test(s)) return 'BOM'
    if (/idfc/i.test(s)) return 'IDFC'
    if (/indusind/i.test(s)) return 'INDUSIND'
    if (/yes bank/i.test(s)) return 'YES'
    if (/federal/i.test(s)) return 'FEDERAL'
    if (/south indian/i.test(s)) return 'SIB'
    if (/karur/i.test(s)) return 'KVB'
    if (/rbl/i.test(s)) return 'RBL'
    if (/dcb/i.test(s)) return 'DCB'
    if (/bandhan/i.test(s)) return 'BANDHAN'
    if (/au small|au sfb/i.test(s)) return 'AUSFB'
    if (/jana/i.test(s)) return 'JANASFB'
    if (/equitas/i.test(s)) return 'EQUITAS'
    if (/ujjivan/i.test(s)) return 'UJJIVAN'
    if (/esaf/i.test(s)) return 'ESAF'
    if (/utkarsh/i.test(s)) return 'UTKARSH'
    if (/paytm/i.test(s)) return 'PAYTM'
    if (/airtel/i.test(s)) return 'AIRTEL'
    if (/fino/i.test(s)) return 'FINO'
    if (/dbs/i.test(s)) return 'DBS'
    if (/hsbc/i.test(s)) return 'HSBC'
    if (/citi/i.test(s)) return 'CITI'
    if (/standard chartered/i.test(s)) return 'SCB'
    if (/saraswat/i.test(s)) return 'SARASWAT'
    if (/tjsb/i.test(s)) return 'TJSB'
    if (/svc bank/i.test(s)) return 'SVC'
    if (/cosmos/i.test(s)) return 'COSMOS'
    return 'GENERIC'
  })()

  const hasSplitAmtCols = /(?:Debit\s+Credit|Withdrawal\s+Deposit|Dr\s+Cr|Withdrawals?\s+Deposits?)/i.test(text)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (SKIP_LINE_PATTERNS.some(p => p.test(line))) continue

    let dateFound: Date | null = null
    const allDateMatches: { index: number; date: Date }[] = []
    for (const pat of DATE_PATTERNS) {
      const re = new RegExp(pat.source, 'g')
      let hit: RegExpExecArray | null
      while ((hit = re.exec(line)) !== null) {
        const d = parseIndianDate(hit[1])
        if (d && d.getFullYear() >= 2010 && d.getFullYear() <= 2035) {
          allDateMatches.push({ index: hit.index, date: d })
        }
      }
    }
    if (allDateMatches.length > 0) {
      allDateMatches.sort((a, b) => a.index - b.index)
      dateFound = allDateMatches[0].date
    }
    if (!dateFound) continue

    const windowLines = [line]
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const nextLine = lines[j]
      if (!nextLine) break
      if (lineHasDate(nextLine) && !SKIP_LINE_PATTERNS.some(p => p.test(nextLine))) break
      if (SKIP_LINE_PATTERNS.some(p => p.test(nextLine))) break
      windowLines.push(nextLine)
    }
    const combined = windowLines.join(' ')
    const amounts = [...combined.matchAll(/[\d,]+\.\d{2}/g)]
      .map(m => parseFloat(m[0].replace(/,/g, '')))
      .filter(n => n <= 1000000000)
    if (!amounts.length) continue

    const dateCountInLine = DATE_PATTERNS.reduce((cnt, p) => cnt + (line.match(new RegExp(p.source, 'gi')) || []).length, 0)
    if (dateCountInLine >= 2 && amounts.length === 0) continue

    let balance: number, amount: number, type: TxnType = 'CR'

    if (hasSplitAmtCols) {
      if (amounts.length >= 3) {
        balance = amounts[amounts.length - 1]
        const maybeCredit = amounts[amounts.length - 2]
        const maybeDebit = amounts[amounts.length - 3]
        const hasDr = /\bDr\.?\b|\bDebit\b|\bWithdrawal\b|\bWD\b|\bDR\b|\/DR\//i.test(combined)
        const hasCr = /\bCr\.?\b|\bCredit\b|\bDeposit\b|\bDP\b|\bCR\b|\/CR\//i.test(combined)
        if (hasDr && !hasCr) { type = 'DR'; amount = maybeDebit || maybeCredit }
        else if (hasCr && !hasDr) { type = 'CR'; amount = maybeCredit || maybeDebit }
        else {
          if (maybeDebit > 0 && maybeCredit === 0) { type = 'DR'; amount = maybeDebit }
          else if (maybeCredit > 0 && maybeDebit === 0) { type = 'CR'; amount = maybeCredit }
          else if (maybeCredit >= maybeDebit) { type = 'CR'; amount = maybeCredit }
          else { type = 'DR'; amount = maybeDebit }
        }
      } else if (amounts.length === 2) {
        balance = amounts[1]; amount = amounts[0]
        const hasDr = /\bDr\.?\b|\bDR\b|\/DR\/|\bDebit\b|\bWithdrawal\b/i.test(combined)
        type = hasDr ? 'DR' : 'CR'
      } else {
        amount = amounts[0]; balance = amounts[0]
        type = /\bDr\.?\b|\bDR\b|\/DR\//i.test(combined) ? 'DR' : 'CR'
      }
    } else {
      if (amounts.length >= 2) {
        balance = amounts[amounts.length - 1]
        const isDr = /\bDr\.?\b|\bDebit\b|\bWithdrawal\b|\bDR\b|\/DR\/|UPI\/DR\/|NEFT\/DR|RTGS.*DEBIT|\bWD\b/i.test(combined)
        const isCr = /\bCr\.?\b|\bCredit\b|\bDeposit\b|\bCR\b|\/CR\/|UPI\/CR\/|NEFT\/CR|RTGS.*CREDIT|\bDP\b/i.test(combined)
        if (isDr && !isCr) { type = 'DR'; amount = amounts[amounts.length - 2] }
        else if (isCr && !isDr) { type = 'CR'; amount = amounts[amounts.length - 2] }
        else {
          amount = amounts[amounts.length - 2]
          type = amount <= balance ? 'CR' : 'DR'
        }
      } else {
        amount = amounts[0]; balance = amounts[0]
        type = /\bDr\.?\b|\bDR\b|\/DR\/|UPI\/DR\//i.test(combined) ? 'DR' : 'CR'
      }
    }

    let desc = stripDates(line)
      .replace(/[\d,]+\.\d{2}/g, '')
      .replace(/\b(Dr|CR|DR|Cr)\b/g, '')
      .replace(/\b\d{12,22}\b/g, '')
      .replace(/\s{2,}/g, ' ').trim().slice(0, 100)
    if (!desc) desc = `Txn-${i + 1}`

    const rawDesc = stripDates(combined)
      .replace(/[\d,]+\.\d{2}/g, '')
      .replace(/\b\d{12,22}\b/g, '')
      .replace(/\s{2,}/g, ' ').trim()

    const category = categorize(rawDesc, type)
    txns.push({ date: dateFound, desc, rawDesc, type, amount, balance, category })
  }

  // Post-process: remove obvious duplicates
  const deduped: Transaction[] = []
  for (let i = 0; i < txns.length; i++) {
    if (i > 0) {
      const prev = txns[i - 1], cur = txns[i]
      const sameCore = prev.date.getTime() === cur.date.getTime() &&
        prev.amount === cur.amount && prev.type === cur.type && prev.balance === cur.balance
      const sameDesc = prev.desc.slice(0, 30) === cur.desc.slice(0, 30)
      if (sameCore && sameDesc) continue
    }
    deduped.push(txns[i])
  }

  log?.('info', `  [${bankHint}] ${hasSplitAmtCols ? 'split-col' : 'single-col'} mode → ${deduped.length} txn(s)`)
  if (deduped.length > 0) {
    const sorted = [...deduped].sort((a, b) => a.date.getTime() - b.date.getTime())
    const fmt2 = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
    log?.('info', `  📅 Date range in file: ${fmt2(sorted[0].date)} → ${fmt2(sorted[sorted.length - 1].date)}`)
  }

  // Post-process: balance delta validation (flags, does not discard)
  let balanceMismatches = 0
  const sortedForValidation = [...deduped].sort((a, b) => a.date.getTime() - b.date.getTime())
  for (let i = 1; i < sortedForValidation.length; i++) {
    const prev = sortedForValidation[i - 1], cur = sortedForValidation[i]
    if (prev.date.getTime() !== cur.date.getTime()) continue
    if (Math.abs(cur.balance - (prev.balance + (cur.type === 'CR' ? cur.amount : -cur.amount))) > 1) {
      cur._balanceMismatch = true
      balanceMismatches++
    }
  }
  if (balanceMismatches > 0) {
    log?.('warn', `  ⚠ ${balanceMismatches} balance delta mismatch(es) detected — rows flagged in UI`)
  }

  return deduped
}
