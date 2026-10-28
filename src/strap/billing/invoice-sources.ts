import { insist, list, person, record, type Actor, type RecordData, type State } from '../domain/types';
import { hasStaffRight, requireStaffRight } from '../domain/staff-rights';

/** Original studio debt and retained tax entries; refunds keep separate identities. */
export function invoiceCharges(state: State, packId: string) {
  const base=list(state,'charge').filter(c=>c.packId===packId && !c.invoiceRefundId);
  const ids=new Set(base.map(c=>c.id));
  const charges=[...base,...list(state,'charge').filter(c=>!ids.has(c.id) && (ids.has(c.taxSourceChargeId) || ids.has(c.parentChargeId)) && ['sales_tax','sales_tax_reversal'].includes(c.reason))];
  const rank=(c:RecordData)=>c.reason==='initiation_fee'?1:c.reason?.startsWith('sales_tax')?2:0;
  return charges.sort((a,b)=>String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || rank(a)-rank(b) || a.id.localeCompare(b.id));
}
export function invoiceAccess(state: State,who: Actor,packId: unknown,staff=false) {
  const pack=record(state,packId,'pack');person(state,pack.personId,false);
  const charges=invoiceCharges(state,pack.id),payerIds=[...new Set(charges.map(c=>c.personId))];
  if(who.role==='owner' && who.isOwner)return pack;
  if(!staff && who.role==='member' && (pack.personId===who.personId || payerIds.includes(who.personId)))return pack;
  insist(['manager','front-desk'].includes(who.role),'invoice_not_found',404);
  requireStaffRight(state,who,'sale',pack.personId,pack.locationId ?? 'studio');return pack;
}
export const invoiceVisible=(state:State,who:Actor,pack:RecordData)=>!!state.people.find(p=>p.id===pack.personId && !p.erasedAt) && (who.role==='owner' && who.isOwner || who.role==='member' && (who.personId===pack.personId || invoiceCharges(state,pack.id).some(c=>c.personId===who.personId)) || ['front-desk','manager'].includes(who.role) && hasStaffRight(state,who,'sale',pack.personId,pack.locationId ?? 'studio'));
export function lineAllocations(state:State,packId:string) {
  const ids=new Set(invoiceCharges(state,packId).map(c=>c.id));
  const allocations=list(state,'contractPrepayment').filter(a=>a.packId===packId && ids.has(a.chargeId));
  for(const payment of list(state,'payment').filter(p=>p.amountCents>0 && ids.has(p.chargeId) && !allocations.some(a=>a.paymentId===p.id)))allocations.push({id:'direct:'+payment.id,paymentId:payment.id,chargeId:payment.chargeId,amountCents:payment.amountCents,packId,personId:payment.personId});
  return allocations;
}
