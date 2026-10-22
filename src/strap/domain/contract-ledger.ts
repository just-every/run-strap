import { list, type State } from './types';

/** Only the covered agreement's debt and explicitly allocated receipts may be shared. */
export function contractBalance(state:State,termsId:string){
  const terms=state.records.get(termsId)?.data;
  if(!terms)return 0;
  const packIds=new Set([terms.packId,terms.currentPackId,...list(state,'recurringInvoice').filter(i=>i.recurringTermsId===termsId).map(i=>i.packId)].filter(Boolean));
  const charges=list(state,'charge'),included=new Set(charges.filter(c=>packIds.has(c.packId)||c.recurringTermsId===termsId).map(c=>c.id));
  for(const charge of charges)if(charge.reversesChargeId&&included.has(charge.reversesChargeId))included.add(charge.id);
  const charged=charges.filter(c=>included.has(c.id)).reduce((n,c)=>n+c.amountCents,0);
  const paid=list(state,'contractPrepayment').filter(a=>packIds.has(a.packId)&&included.has(a.chargeId)).reduce((n,a)=>n+a.amountCents,0);
  return charged-paid;
}
