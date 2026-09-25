import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { ErrorState } from '@/components/ui/States'
import { csvEscape } from '@/utils/csv'
import { downloadBlob } from '@/utils/reportExport'
import { formatCurrency, formatDate } from '@/utils/format'
import { offerWorkflowApi, OFFER_STATUS_LABEL, DEVIATION_STATUS_LABEL, type OfferPipelineRow } from '@/api/offerWorkflowApi'
import { banksApi } from '@/api/banksApi'

// Offers → deviation → credit approval → sanction → disbursement register,
// one row per lender offer. Scope and masking are applied by the API
// (GET /api/reports/offer-pipeline): only applications the caller can see,
// and no internal Base ROI / deviation types for channel partners.

const COLUMNS: [string, (r: OfferPipelineRow) => string | number][] = [
  ['Application', r => r.loanNumber], ['Applicant', r => r.applicantName], ['Application status', r => r.applicationStatus],
  ['Lender', r => r.lenderName], ['Offer status', r => OFFER_STATUS_LABEL[r.offerStatus] ?? r.offerStatus],
  ['Final lender', r => (r.isFinalLender ? 'Yes' : '')], ['Revision', r => r.revisionNo], ['Amount', r => r.loanAmount],
  ['Tenure (mo)', r => r.tenureMonths], ['Base ROI', r => r.baseRoi ?? ''], ['Offered ROI', r => r.offeredRoi], ['EMI', r => r.emi],
  ['Net disbursement', r => r.netDisbursement], ['Deviation', r => DEVIATION_STATUS_LABEL[r.deviationStatus] ?? r.deviationStatus],
  ['Deviation types', r => r.deviationTypes ?? ''], ['Credit approval', r => r.approvalStatus], ['Approved on', r => (r.approvedAt ? formatDate(r.approvedAt) : '')],
  ['Sanction no.', r => r.sanctionNumber ?? ''], ['Sanction status', r => r.sanctionStatus ?? ''], ['Sanctioned on', r => (r.sanctionedAt ? formatDate(r.sanctionedAt) : '')],
  ['Sanction amount', r => r.sanctionAmount ?? ''], ['Disbursed amount', r => r.disbursedAmount ?? ''],
  ['Disbursed on', r => (r.disbursedAt ? formatDate(r.disbursedAt) : '')], ['Disbursement status', r => r.disbursementStatus ?? ''],
  ['Offer created', r => formatDate(r.offerCreatedAt)],
]

export default function OfferPipelineReport() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [bankId, setBankId] = useState(0)
  const [offerStatus, setOfferStatus] = useState('')
  const { data: banks = [] } = useQuery({ queryKey: ['banks-for-report'], queryFn: () => banksApi.getAll().then(r => r.data.data ?? []), retry: false })
  const { data: rows, isLoading, error, refetch } = useQuery({
    queryKey: ['offer-pipeline-report', from, to, bankId, offerStatus],
    queryFn: () => offerWorkflowApi.pipelineReport({ from: from || undefined, to: to || undefined, bankId: bankId || undefined, offerStatus: offerStatus || undefined })
      .then(r => r.data.data ?? []),
  })
  const exportCsv = () => {
    if (!rows) return
    const csv = [COLUMNS.map(c => csvEscape(c[0])).join(','), ...rows.map(r => COLUMNS.map(c => csvEscape(c[1](r))).join(','))].join('\n')
    downloadBlob(csv, `offer-sanction-disbursement-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8')
  }
  return (
    <Card>
      <CardHeader title="Offers, Sanction & Disbursement" subtitle="One row per lender offer — deviation, credit approval, sanction and disbursement status"
        action={<Button size="sm" variant="secondary" disabled={!rows?.length} onClick={exportCsv}><Download size={14} className="mr-1" />Export CSV</Button>} />
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div><label className="mb-1 block text-xs" style={{ color: 'var(--text3)' }}>Offer from</label><input type="date" className="efin-input" value={from} onChange={e => setFrom(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs" style={{ color: 'var(--text3)' }}>to</label><input type="date" className="efin-input" value={to} onChange={e => setTo(e.target.value)} /></div>
        <div><label className="mb-1 block text-xs" style={{ color: 'var(--text3)' }}>Lender</label>
          <select className="efin-input" value={bankId} onChange={e => setBankId(Number(e.target.value))}>
            <option value={0}>All</option>{banks.map(b => <option key={b.id} value={b.id}>{b.bankName}</option>)}
          </select>
        </div>
        <div><label className="mb-1 block text-xs" style={{ color: 'var(--text3)' }}>Offer status</label>
          <select className="efin-input" value={offerStatus} onChange={e => setOfferStatus(e.target.value)}>
            <option value="">All</option>{Object.entries(OFFER_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      {isLoading ? <LoadingSpinner /> : error ? <ErrorState error={error} onRetry={() => refetch()} /> : !rows?.length ? (
        <p className="text-sm" style={{ color: 'var(--text3)' }}>No offers match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="text-left" style={{ color: 'var(--text3)' }}>
              {['Application', 'Lender', 'Offer', 'Amount', 'ROI', 'EMI', 'Deviation', 'Credit', 'Sanction', 'Disbursed'].map(h => <th key={h} className="py-1.5 pr-3">{h}</th>)}
            </tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.offerId} className="border-t" style={{ borderColor: 'var(--border)', color: 'var(--text2)' }}>
                <td className="py-1.5 pr-3 font-semibold" style={{ color: 'var(--text)' }}>{r.loanNumber}<div className="font-normal" style={{ color: 'var(--text3)' }}>{r.applicantName}</div></td>
                <td className="pr-3">{r.lenderName}{r.isFinalLender ? ' ★' : ''}</td>
                <td className="pr-3">{OFFER_STATUS_LABEL[r.offerStatus] ?? r.offerStatus} · rev {r.revisionNo}</td>
                <td className="pr-3">{formatCurrency(r.loanAmount)}</td>
                <td className="pr-3">{r.offeredRoi}%{r.baseRoi != null ? <span style={{ color: 'var(--text3)' }}> (base {r.baseRoi}%)</span> : null}</td>
                <td className="pr-3">{formatCurrency(r.emi)}</td>
                <td className="pr-3">{DEVIATION_STATUS_LABEL[r.deviationStatus] ?? r.deviationStatus}{r.deviationTypes ? ` · ${r.deviationTypes}` : ''}</td>
                <td className="pr-3">{r.approvalStatus}</td>
                <td className="pr-3">{r.sanctionNumber ? `${r.sanctionNumber} (${r.sanctionStatus})` : '—'}</td>
                <td className="pr-3">{r.disbursedAmount != null ? `${formatCurrency(r.disbursedAmount)} · ${r.disbursementStatus}` : '—'}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
