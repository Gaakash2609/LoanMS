import type { ApplicationOffer, LoanWorkflow, OfferDeviationRequest } from '@/api/offerWorkflowApi'

// Which buttons the Offers tab shows. Pure functions of the server's workflow
// (capabilities + stage + record state) so the button matrix is unit-tested;
// the API still re-checks every action (403 / 409) — this only hides what the
// caller could not do anyway.

export type OfferCardAction = 'select' | 'unselect' | 'raise' | 'skip' | 'credit' | 'revise' | 'withdraw'

export function offerCardActions(o: ApplicationOffer, wf: LoanWorkflow): OfferCardAction[] {
  const cap = wf.capabilities
  const atOffer = wf.loanStatus === 'Offer'
  const isFinal = o.status === 'Final'
  const out: OfferCardAction[] = []
  if (atOffer && cap.canSelectOffer && (o.status === 'Available' || o.status === 'NotSelected') && !wf.offers.some(x => x.status === 'Final'))
    out.push('select')
  if (atOffer && isFinal && cap.canSelectOffer) out.push('unselect')
  if (isFinal && cap.canRaiseDeviation) out.push('raise')
  if (isFinal && cap.canSkipDeviation) out.push('skip')
  if (isFinal && cap.canCreditApprove) out.push('credit')
  if (o.isActive && (cap.canManageOffers || (isFinal && cap.canEditApprovedTerms))) out.push('revise')
  if ((o.isActive || o.status === 'NotSelected') && cap.canManageOffers) out.push('withdraw')
  return out
}

export type DeviationAction = 'decide' | 'ownRequest' | 'reassign'

export function deviationActions(d: OfferDeviationRequest, wf: LoanWorkflow, myUserId: number | undefined): DeviationAction[] {
  if (d.status !== 'Raised') return []
  const out: DeviationAction[] = []
  if (wf.capabilities.canDecideDeviation) out.push(d.raisedByUserId === myUserId ? 'ownRequest' : 'decide')
  if (wf.capabilities.canReassignDeviation) out.push('reassign')
  return out
}
