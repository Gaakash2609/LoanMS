import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Link2, Search } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { loansApi } from '@/api/loansApi'
import type { DsaPartner } from '@/api/dsaApi'

// Total application count for one DSA card — direct-channel count plus each
// mapped partner's count, summed from PagedResult.totalCount (pageSize: 1,
// so this only reads the count, never the rows). Its own hook so each
// card's count is fetched/cached independently and the modal body doesn't
// block on every DSA's count before rendering.
function useDsaAppsCount(dsaId: number, partnerIds: number[]) {
  return useQuery({
    queryKey: ['dsaAppsCount', dsaId, partnerIds.join(',')],
    queryFn: async () => {
      const requests = [
        loansApi.getAll({ dsaId, pageSize: 1 }).then(r => r.data.data?.totalCount ?? 0),
        ...partnerIds.map(pid => loansApi.getAll({ partnerId: pid, pageSize: 1 }).then(r => r.data.data?.totalCount ?? 0)),
      ]
      const counts = await Promise.all(requests)
      return counts.reduce((a, b) => a + b, 0)
    },
    staleTime: 30_000,
  })
}

// DSA ↔ Partner mapping overview — matches Vanilla's dsaOpenMappingOverview /
// renderDsaMappingOverview (efin-app.js:30997). For each DSA (optionally
// narrowed to one via the row's "🔗 N Partners" button, or by the filter
// dropdown), lists every Partner mapped to it (DsaPartner.MappedDsaId), with
// a partner-count chip and an "Apps" chip that opens the combined
// applications drill-down (DsaAppsModal). Clicking a partner card narrows
// that drill-down to just that partner (dsaViewPartnerApps parity).
export default function DsaMappingOverviewModal({
  dsaList, partnerList, initialDsaId, onClose, onViewApps,
}: {
  dsaList: DsaPartner[]
  partnerList: DsaPartner[]
  initialDsaId?: number | null
  onClose: () => void
  onViewApps: (dsa: DsaPartner, partner?: DsaPartner) => void
}) {
  const [search, setSearch] = useState('')
  const [dsaFilter, setDsaFilter] = useState<number | ''>(initialDsaId ?? '')

  const lc = search.trim().toLowerCase()
  const scopedDsas = dsaList.filter(d => !dsaFilter || d.id === dsaFilter)

  const cards = scopedDsas
    .map(dsa => {
      let partners = partnerList.filter(p => p.mappedDsaId === dsa.id)
      if (lc) {
        const dsaMatch = dsa.name.toLowerCase().includes(lc) || dsa.code.toLowerCase().includes(lc)
        if (!dsaMatch) {
          partners = partners.filter(p =>
            p.name.toLowerCase().includes(lc) || p.code.toLowerCase().includes(lc) || (p.phone ?? '').includes(lc))
          if (!partners.length) return null
        }
      }
      return { dsa, partners }
    })
    .filter((x): x is { dsa: DsaPartner; partners: DsaPartner[] } => x !== null)

  return (
    <Modal open onClose={onClose} title="DSA ↔ Partner Mapping" size="xl"
      footer={<Button size="sm" variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search DSA or partner…"
            className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-efin-blue" />
        </div>
        <select value={dsaFilter} onChange={e => setDsaFilter(e.target.value ? Number(e.target.value) : '')}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
          <option value="">All DSAs</option>
          {dsaList.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {!dsaList.length ? (
        <div className="text-center py-14 text-gray-400">
          <p className="text-3xl mb-2">🔗</p><p className="text-sm">No DSAs found</p>
        </div>
      ) : !cards.length ? (
        <div className="text-center py-14 text-gray-400">
          <p className="text-3xl mb-2">🔍</p><p className="text-sm">No results for &quot;{search}&quot;</p>
        </div>
      ) : (
        <div className="space-y-4">
          {cards.map(({ dsa, partners }) => (
            <DsaMappingCard key={dsa.id} dsa={dsa} partners={partners} onViewApps={onViewApps} onClose={onClose} />
          ))}
        </div>
      )}
    </Modal>
  )
}

function DsaMappingCard({
  dsa, partners, onViewApps, onClose,
}: {
  dsa: DsaPartner
  partners: DsaPartner[]
  onViewApps: (dsa: DsaPartner, partner?: DsaPartner) => void
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { data: appsCount } = useDsaAppsCount(dsa.id, partners.map(p => p.id))
  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      <div className="flex items-center gap-3.5 px-5 py-4 bg-gradient-to-r from-efin-blue/5 to-transparent border-b border-gray-200">
        <div className="w-11 h-11 rounded-xl bg-efin-blue/10 flex items-center justify-center text-lg font-extrabold text-efin-blue shrink-0">
          {dsa.name.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-sm text-gray-900">{dsa.name}</p>
          <div className="flex gap-3 mt-0.5 flex-wrap text-[11.5px] text-gray-500">
            <code className="bg-gray-100 px-1.5 rounded">{dsa.code}</code>
            {dsa.phone && <span>📱 {dsa.phone}</span>}
            {dsa.email && <span>✉️ {dsa.email}</span>}
          </div>
        </div>
        <div className="flex gap-2 items-center flex-wrap shrink-0">
          <div className="text-center bg-purple-100 border border-purple-200 rounded-lg px-3.5 py-1.5">
            <div className="text-xl font-extrabold text-purple-700 leading-none">{partners.length}</div>
            <div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide mt-0.5">
              Partner{partners.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button
            onClick={() => onViewApps(dsa)}
            title="View all applications for this DSA"
            className="text-center bg-efin-blue/10 border border-efin-blue/25 rounded-lg px-3.5 py-1.5 hover:bg-efin-blue/15">
            <div className="text-xl font-extrabold text-efin-blue leading-none">{appsCount ?? '—'}</div>
            <div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide mt-0.5">Apps</div>
          </button>
          <Badge variant={dsa.isActive ? 'success' : 'danger'}>{dsa.isActive ? 'Active' : 'Inactive'}</Badge>
        </div>
      </div>
      {partners.length === 0 ? (
                // Matches Vanilla's empty-state row (efin-app.js:31088), which
                // includes a "＋ Map a Partner" link that closes this overlay
                // and navigates to Partner Management — previously dropped,
                // leaving just the italic text with no way to act on it.
                <p className="px-5 py-4 text-sm italic text-gray-400 flex flex-wrap items-center gap-2">
                  No partners mapped to this DSA yet.
                  <Button size="sm" variant="ghost" onClick={() => { onClose(); navigate('/partners') }}>
                    ＋ Map a Partner
                  </Button>
                </p>
              ) : (
                <div className="p-4 grid gap-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
                  {partners.map(p => (
                    <button key={p.id} onClick={() => onViewApps(dsa, p)}
                      className="flex items-center gap-2.5 px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-left hover:border-purple-300 hover:bg-purple-50 transition-colors">
                      <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center text-xs font-extrabold text-purple-700 shrink-0">
                        {p.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-gray-900 truncate">{p.name}</p>
                        <div className="flex gap-2 mt-0.5 items-center">
                          <code className="text-[10px] bg-gray-200 px-1 rounded">{p.code}</code>
                          {p.category && <span className="text-[10.5px] font-semibold text-gray-500">{p.category}</span>}
                        </div>
                      </div>
                      <Link2 size={13} className="text-gray-300 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
    </div>
  )
}
