import { id, list, now, type RecordData, type State } from './types';
import type { Transaction } from './store';

export function coolingAgreementPackIds(state:State,c:RecordData):string[]{
  if(c.coolingOff?.renewal)return [c.packId];
  const terms=state.records.get(c.termsId)?.data;
  return [...new Set([c.packId,terms?.packId,terms?.currentPackId,...list(state,'recurringInvoice').filter(i=>i.recurringTermsId===c.termsId).map(i=>i.packId)].filter(Boolean))];
}
/** Paid money remains owed externally; only unpaid receivables are reversed. */
export function voidUnpaidCoolingInvoices(tx:Transaction,c:RecordData){
  const packIds=new Set(coolingAgreementPackIds(tx.state,c)),charges=list(tx.state,'charge'),allocations=list(tx.state,'contractPrepayment');
  const voids:RecordData[]=[];
  for(const charge of charges.filter(r=>packIds.has(r.packId)&&r.amountCents>0&&!r.reversesChargeId)){
    const paid=allocations.filter(a=>a.chargeId===charge.id).reduce((n,a)=>n+a.amountCents,0),reversed=-charges.filter(r=>r.reversesChargeId===charge.id).reduce((n,r)=>n+r.amountCents,0),unpaid=Math.max(0,charge.amountCents-paid-reversed);
    if(!unpaid)continue;
    const reversal={id:id(),personId:charge.personId,packId:charge.packId,amountCents:-unpaid,reversesChargeId:charge.id,reason:'cooling_off_unpaid_void',cancellationId:c.id,createdAt:now()};
    tx.put('charge',reversal);voids.push(reversal);
  }
  for(const invoice of list(tx.state,'recurringInvoice').filter(i=>packIds.has(i.packId)&&i.recurringTermsId===c.termsId)){
    const voidedUnpaidCents=list(tx.state,'charge').filter(r=>r.packId===invoice.packId&&r.reason==='cooling_off_unpaid_void'&&r.cancellationId===c.id).reduce((n,r)=>n-r.amountCents,0);
    if(voidedUnpaidCents)tx.put('recurringInvoice',{...invoice,status:'void',voidedUnpaidCents,cancellationId:c.id,voidedAt:now()});
  }
  return voids;
}
