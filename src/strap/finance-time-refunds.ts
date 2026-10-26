import { list, type State, type RecordData } from './domain/types'
import { countsCredits } from './domain/entitlements'
import { halfUp } from './domain/plan-changes'

/** Ordinary refunds return unearned time-based value without changing its original interval. */
export function timeRefundClassification(state: State, at: number) {
  const result=new Map<string,{refundIds:Set<string>;chargeId:string;serviceThrough:number}>()
  const before=(r:RecordData)=>Date.parse(r.createdAt)<at
  const dues=list(state,'cancellationRefund').filter(before),charges=list(state,'charge').filter(before)
  for(const pack of list(state,'pack')) {
    const refunds=dues.filter(r=>r.packId===pack.id),draft=state.records.get(pack.draftId)?.data
    if(!refunds.length||!draft||draft.type!=='pack'||draft.status!=='approved'||countsCredits(draft)||countsCredits(pack))continue
    if(pack.initiationFeeCents>0||draft.initiationFeeCents>0||refunds.some(r=>!Number.isSafeInteger(r.amountCents)||r.amountCents<0||r.coolingOptions))continue
    if(list(state,'planChange').some(c=>c.packId===pack.id&&c.status==='applied'&&Date.parse(c.appliedAt)<at))continue
    if(list(state,'freeze').some(f=>f.packId===pack.id&&f.confirmedAt&&Date.parse(f.confirmedAt)<at))continue
    const consideration=charges.filter(c=>c.packId===pack.id&&!['sales_tax','sales_tax_reversal'].includes(c.reason))
    if(consideration.length!==1)continue
    const original=consideration[0],start=Date.parse(pack.proration?.joinAt??pack.createdAt),end=Date.parse(draft.expiresAt)
    if(original.reason||original.kind||!Number.isSafeInteger(original.amountCents)||original.amountCents<=0||original.amountCents!==draft.amountCents)continue
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)continue
    const cancellations=refunds.map(r=>state.records.get(r.cancellationId))
    if(cancellations.some(row=>row?.kind!=='contractCancellation'))continue
    const stops=cancellations.map(row=>row!.data)
    if(new Set(stops.map(c=>c.id)).size!==1)continue
    const cancellation=stops[0],serviceThrough=Date.parse(cancellation.effectiveAt)
    if(cancellation.packId!==pack.id||cancellation.status!=='applied'||!cancellation.confirmedAt||Date.parse(cancellation.confirmedAt)>=at||cancellation.disposition!=='refund_due'||cancellation.reasonCode==='cooling-off')continue
    if(!Number.isFinite(serviceThrough)||serviceThrough<start||serviceThrough>end||serviceThrough>=at)continue
    if(refunds.some(r=>r.effectiveAt!==cancellation.effectiveAt||r.valuationPack?.expiresAt!==draft.expiresAt||r.valuationPack?.amountCents!==draft.amountCents))continue
    const earned=halfUp(BigInt(original.amountCents)*BigInt(serviceThrough-start),BigInt(end-start))
    const refundCents=refunds.reduce((n,r)=>n+r.amountCents,0)
    if(!Number.isSafeInteger(refundCents)||refundCents>original.amountCents-earned)continue
    result.set(pack.id,{refundIds:new Set(refunds.map(r=>r.id)),chargeId:original.id,serviceThrough})
  }
  return result
}
