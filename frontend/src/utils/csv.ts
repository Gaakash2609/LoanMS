// Shared CSV helpers for bulk-import modals (eligibility lines, bank master).
// Kept in one place so the line- and bank-import flows don't each carry their
// own copy of the parser.

/** Minimal RFC-4180-ish CSV split: handles quoted fields containing commas. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQ = false
      else cur += c
    } else if (c === '"') inQ = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map(s => s.trim())
}

/** Split CSV text into non-empty rows of cells, optionally skipping a header. */
export function parseCsvRows(text: string, headerFirstCell?: string): string[][] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length === 0) return []
  const first = parseCsvLine(lines[0]).map(s => s.toLowerCase())
  const skipHeader = headerFirstCell ? first[0]?.includes(headerFirstCell.toLowerCase()) : false
  return lines.slice(skipHeader ? 1 : 0).map(parseCsvLine)
}

/** Truthy CSV boolean tokens: yes / true / 1 / y. */
export function csvBool(v: string | undefined): boolean {
  return ['yes', 'true', '1', 'y'].includes((v ?? '').trim().toLowerCase())
}
