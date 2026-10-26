import { list, type State, type RecordData } from './domain/types'
import { countsCredits } from './domain/entitlements'
import { halfUp } from './domain/plan-changes'

/** Supported refunds return unearned finite-pack value; they never earn forfeited credits. */
export function finiteRefundClassification(state: State,at: number) {
  const result=new Map<string,{refundIds: Set<string>;chargeId: string}>()
  const before=(r: RecordData)=>Date.parse(r.createdAt)<at
  const dues=list(state,'cancellationRefund').filter(before),charges=list(state,'charge').filter(before)
  const bookings=list(state,'booking'),classes=list(state,'class')
  for(const pack of list(state,'pack')) {
    const refunds=dues.filter(r=>r.packId===pack.id),draft=state.records.get(pack.draftId)?.data
    if(!refunds.length||!draft||draft.type!=='pack'||!countsCredits(pack)||!Number.isSafeInteger(draft.credits)||draft.credits<=0)continue
    // Cooling-off fees and mixed consideration need their own supported allocation.
    if(refunds.some(r=>r.amountCents===null||r.coolingOptions)||pack.initiationFeeCents>0)continue
    if(list(state,'planChange').some(c=>c.packId===pack.id&&c.status==='applied'&&Date.parse(c.appliedAt)<at))continue
    const consideration=charges.filter(c=>c.packId===pack.id&&!['sales_tax','sales_tax_reversal'].includes(c.reason))
    if(consideration.length!==1)continue
    const original=consideration[0]
    if(original.reason||original.kind||original.amountCents!==draft.amountCents||original.amountCents<0)continue
    const attended=bookings.filter(b=>b.packId===pack.id&&b.attendance==='attended'&&Date.parse(b.checkedInAt ?? '')<at&&classes.some(c=>c.id===b.classId&&Date.parse(c.end)<at)).length
    const earned=halfUp(BigInt(original.amountCents)*BigInt(Math.min(draft.credits,attended)),BigInt(draft.credits))
    const refundCents=refunds.reduce((n,r)=>n+r.amountCents,0)
    if(refundCents<0||refundCents>original.amountCents-earned)continue
    result.set(pack.id,{refundIds:new Set(refunds.map(r=>r.id)),chargeId:original.id})
  }
  return result
}
