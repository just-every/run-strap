import { list, type State, type RecordData } from './domain/types'

/** Recorded external refunds are distinct from invoice credits and provider refunds. */
export function financeRefunds(state: State) {
  const dues = list(state,'cancellationRefund'), settlements = list(state,'cancellationRefundSettlement')
  const sources = [
    ...dues.map(record => ({kind:'refund-due',record,at:record.createdAt,amountCents:record.amountCents === null ? null : -record.amountCents})),
    ...settlements.map(record => ({kind:'refund-cash',record,at:record.recordedAt,amountCents:-record.amountCents}))
  ]
  const snapshot = (at: number) => {
    const before = (r: RecordData) => Date.parse(r.createdAt) < at
    const known = dues.filter(before).filter(r=>r.amountCents !== null)
    const paid = settlements.filter(r=>Date.parse(r.recordedAt) < at)
    const dueCents = known.reduce((n,r)=>n+r.amountCents,0), settledCents = paid.reduce((n,r)=>n+r.amountCents,0)
    // Refund approval and settlement never invent a negative invoice or alter entitlements.
    // Until service-refund classification exists, the approved amount reduces unclassified
    // value and becomes an explicit payable. Settlement reduces cash and that payable once.
    const rows = known.map(r=>({id:r.id,personId:r.personId,packId:r.packId,amountCents:-r.amountCents,earnedCents:0,deferredCents:0,unusedPackCents:0,unclassifiedCents:-r.amountCents,basis:'Approved refund due; service classification unavailable',serviceStart:r.valuationPack?.termStartAt ?? r.valuationPack?.createdAt ?? null,serviceEnd:r.valuationPack?.expiresAt ?? null,consumedBookingIds:[] as string[]}))
    return {rows,dueCents,settledCents,payableCents:dueCents-settledCents,unavailableIds:dues.filter(before).filter(r=>r.amountCents===null).map(r=>r.id)}
  }
  return {sources,snapshot}
}
