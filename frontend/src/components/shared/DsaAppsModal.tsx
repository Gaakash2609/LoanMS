import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { SkeletonText } from '@/components/ui/Skeleton'
import { formatCurrency, formatDate, LOAN_TYPE_LABELS } from '@/utils/format'
import { loansApi } from '@/api/loansApi'
import type { LoanListItem } from '@/types'

// Applications drill-down for one DSA (optionally scoped to one of its
// mapped Partners) — matches Vanilla's dsaViewApps(dsaId, filterPartnerId)
// (efin-app.js:31127): "Direct DSA" applications (Loan.DsaId == dsa.id) plus
// every application sourced through a partner mapped to this DSA
// (Loan.PartnerId in mappedPartnerIds), combined into one table with a "Via"
// column, or narrowed to a single partner when opened via
// dsaViewPartnerApps.
//
// Loan.DsaId/PartnerId are mutually exclusive per application (set by the
// wizard's channel radio — NewApplicationPage.tsx:3053/3054), so which one
// is populated tells us the "Via" source without a separate Channel column.
//
// VERIFIED: Vanilla's direct-DSA filter was `a.channel==='dsa' &&
// (a.dsaId===dsaId || a.channelDSA===dsa.name)` — an id-or-name OR, needed
// because Vanilla's flat client-side app objects could have the DSA name
// typed/selected without the numeric id reliably landing on a.dsaId.
// There's no equivalent to reproduce here: Loan has only a DsaId FK (no
// Channel or ChannelDSA-name column — see Loan.cs), and the wizard's own
// validation requires data.dsaId whenever channel==='dsa' before submit
// will even go through (NewApplicationPage.tsx:600), so a submitted
// DSA-channel loan can't end up with DsaId unset the way a Vanilla record
// could. Filtering on Loan.DsaId alone is therefore full parity with what
// Vanilla's OR was actually working around, not a narrower behavior.
const PAGE_SIZE = 200

interface AppRow extends LoanListItem {
  _via: string
}

export default function DsaAppsModal({
  dsaId, dsaName, dsaCode,
  mappedPartners, filterPartner,
  onClose,
}: {
  dsaId: number
  dsaName: string
  dsaCode: string
  /** Every Partner currently mapped to this DSA (id + name), for the combined view. */
  mappedPartners: { id: number; name: string }[]
  /** When set (opened via the "N partners" mapping overview → one partner card), scope to just this partner. */
  filterPartner?: { id: number; name: string } | null
  onClose: () => void
}) {
  const navigate = useNavigate()

  const partnerIds = filterPartner ? [filterPartner.id] : mappedPartners.map(p => p.id)
  const partnerNameById = useMemo(() => {
    const m = new Map<number, string>()
    mappedPartners.forEach(p => m.set(p.id, p.name))
    if (filterPartner) m.set(filterPartner.id, filterPartner.name)
    return m
  }, [mappedPartners, filterPartner])

  const { data, isLoading, error } = useQuery({
    queryKey: ['dsaApps', dsaId, filterPartner?.id ?? null, partnerIds.join(',')],
    queryFn: async () => {
      const requests: Promise<{ rows: LoanListItem[]; via: (l: LoanListItem) => string }>[] = []

      // Direct DSA-channel applications — skipped entirely when scoped to
      // one partner (legacy only shows that partner's apps in that mode).
      if (!filterPartner) {
        requests.push(
          loansApi.getAll({ dsaId, pageSize: PAGE_SIZE }).then(r => ({
            rows: r.data.data?.items ?? [],
            via: () => 'Direct DSA',
          })),
        )
      }

      // Partner-sourced applications, one request per mapped partner (or
      // just the one being filtered to).
      partnerIds.forEach(pid => {
        requests.push(
          loansApi.getAll({ partnerId: pid, pageSize: PAGE_SIZE }).then(r => ({
            rows: r.data.data?.items ?? [],
            via: () => partnerNameById.get(pid) ?? 'Partner',
          })),
        )
      })

      const results = await Promise.all(requests)
      const merged: AppRow[] = []
      results.forEach(({ rows, via }) => rows.forEach(row => merged.push({ ...row, _via: via(row) })))
      merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      return merged
    },
  })

  const apps = data ?? []
  const title = filterPartner ? `Applications — ${filterPartner.name}` : `Applications — ${dsaName}`
  const subtitle = filterPartner
    ? `Filtered to partner · ${apps.length} application${apps.length !== 1 ? 's' : ''}`
    : `${dsaName} (${dsaCode}) · ${apps.length} total application${apps.length !== 1 ? 's' : ''}`

  return (
    <Modal open onClose={onClose} title={title} subtitle={subtitle} size="xl"
      footer={<Button size="sm" variant="secondary" onClick={onClose}>Close</Button>}>
      {isLoading ? (
        <SkeletonText lines={5} className="py-2" />
      ) : error ? (
        <p className="text-sm text-red-600 py-6 text-center">Could not load applications.</p>
      ) : apps.length === 0 ? (
        <p className="text-sm text-gray-400 py-10 text-center">No applications found for this DSA.</p>
      ) : (
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b-2 border-gray-200 text-left">
                <th className="px-5 py-2.5 text-[10.5px] font-bold text-gray-500 uppercase tracking-wide">App ID</th>
                <th className="px-4 py-2.5 text-[10.5px] font-bold text-gray-500 uppercase tracking-wide">Applicant</th>
                <th className="px-4 py-2.5 text-[10.5px] font-bold text-gray-500 uppercase tracking-wide">Via</th>
                <th className="px-4 py-2.5 text-[10.5px] font-bold text-gray-500 uppercase tracking-wide">Loan Type</th>
                <th className="px-4 py-2.5 text-right text-[10.5px] font-bold text-gray-500 uppercase tracking-wide">Amount</th>
                <th className="px-4 py-2.5 text-[10.5px] font-bold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-2.5 text-[10.5px] font-bold text-gray-500 uppercase tracking-wide">Date</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {apps.map(a => (
                <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <span className="font-mono text-xs font-bold text-efin-blue bg-efin-blue/10 px-2 py-0.5 rounded">
                      {a.loanNumber}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{a.customerName || '—'}</p>
                    <p className="text-xs text-gray-500">{a.customerPhone || ''}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                      a._via === 'Direct DSA' ? 'bg-efin-blue/10 text-efin-blue' : 'bg-purple-100 text-purple-700'
                    }`}>{a._via}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{LOAN_TYPE_LABELS[a.loanType] ?? a.loanType}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatCurrency(a.requestedAmount)}</td>
                  <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(a.createdAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <button className="text-xs font-semibold text-efin-blue hover:underline"
                      onClick={() => { onClose(); navigate(`/loans/${a.id}`) }}>
                      Open →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
