import { humanOwner, id, insist, integer, list, now, record, text, type Actor, type State } from './types';
import type { Transaction } from './store';
import { contractNotice } from './contract-billing';

/** Explicit owner scheduling: a disclosure never changes an accepted agreement. */
export function scheduleRenewalDisclosure(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const requestId=text(input.requestId,'requestId',100), basis=JSON.stringify(input);
  const prior=list(tx.state,'renewalDisclosure').find(d=>d.createdBy===tx.who.id&&d.requestId===requestId);
  if(prior){insist(prior.requestBasis===basis,'disclosure_request_changed',409);return prior;}
  const terms=record(tx.state,input.termsId,'recurringTerms');
  insist(terms.status==='active'&&terms.acceptedAt,'accepted_active_agreement_required',409);
  const leadDays=integer(input.leadDays,'leadDays',15,365),dueAt=terms.nextRenewalAt;
  const sendAt=new Date(Date.parse(dueAt)-leadDays*86400000).toISOString();
  insist(sendAt>now(),'disclosure_lead_time_already_passed',409);
  const proposedAmountCents=input.proposedAmountCents===undefined ? null : integer(input.proposedAmountCents,'proposedAmountCents',0,100_000_000);
  insist(proposedAmountCents===null||proposedAmountCents!==terms.amountCents,'price_change_requires_new_amount',409);
  insist(!list(tx.state,'renewalDisclosure').some(d=>d.termsId===terms.id&&d.dueAt===dueAt&&['scheduled','delivered'].includes(d.status)),'renewal_disclosure_exists',409);
  const disclosure={id:id(),personId:terms.personId,termsId:terms.id,packId:terms.currentPackId,dueAt,sendAt,leadDays,proposedAmountCents,
    acceptedTermsKey:terms.key,acceptedAt:terms.acceptedAt,acceptedBy:terms.acceptedBy,currentAmountCents:terms.amountCents,intervalMonths:terms.intervalMonths,
    stopPath:terms.stopPath,status:'scheduled',createdAt:now(),createdBy:tx.who.id,requestId,requestBasis:basis,
    policy:'A proposed price never changes this agreement. Stop future invoices, then review a separate exact member-accepted plan change. No payment is authorized or collected.'};
  tx.put('renewalDisclosure',disclosure);return disclosure;
}
export function cancelRenewalDisclosure(tx: Transaction,input:Record<string,unknown>){
  humanOwner(tx.who);const d=record(tx.state,input.id,'renewalDisclosure');
  if(d.status==='cancelled')return d;
  insist(d.status==='scheduled','disclosure_already_closed',409);
  const closed={...d,status:'cancelled',cancelledAt:now(),cancelledBy:tx.who.id};tx.put('renewalDisclosure',closed);return closed;
}
/** Uses the existing atomic reservation and configured Base sender, once per disclosure. */
export async function deliverRenewalDisclosures(tx:Transaction){
  const connection=await tx.db.prepare("SELECT connection_id,origin FROM st_contract_connections WHERE id='billing'").first<{connection_id:string;origin:string}>();
  for(const d of list(tx.state,'renewalDisclosure').filter(d=>d.status==='scheduled'&&d.sendAt<=now())){
    const terms=tx.state.records.get(d.termsId)?.data;
    if(!connection||connection.connection_id!==terms?.connectionId||connection.origin!==tx.notices.origin||terms?.billingOrigin!==tx.notices.origin||!terms||terms.status!=='active'||terms.key!==d.acceptedTermsKey||terms.nextRenewalAt!==d.dueAt||terms.currentPackId!==d.packId||terms.amountCents!==d.currentAmountCents||now()>=d.dueAt){tx.put('renewalDisclosure',{...d,status:'stale',closedAt:now()});continue;}
    tx.reached(d.sendAt);tx.future(d.dueAt);
    const body=`Your next studio invoice is due ${d.dueAt}: $${(d.currentAmountCents/100).toFixed(2)} every ${d.intervalMonths} calendar month(s). `
      +(d.proposedAmountCents===null?'':`The studio proposes $${(d.proposedAmountCents/100).toFixed(2)} for a future plan. This does not change your accepted price. `)
      +`${d.policy} Stop immediately without a reason after signing in: ${d.stopPath}. Access continues to the current paid term end.`;
    const delivery=contractNotice(tx,`renewal-disclosure:${d.id}`,d.personId,d.proposedAmountCents===null?'Upcoming renewal disclosure':'Proposed price change disclosure',body);
    tx.put('renewalDisclosure',{...d,status:'delivered',deliveredAt:now(),body,noticeId:`notice:renewal-disclosure:${d.id}`,delivery});
  }
}
export async function renewalDisclosuresSnapshot(db:D1Database,state:State,who:Actor){
  const deliveries=(await db.prepare("SELECT id,status FROM st_notice_deliveries WHERE source_id LIKE 'renewal-disclosure:%'").all<{id:string;status:string}>()).results;
  return list(state,'renewalDisclosure').filter(d=>who.role==='owner'||who.role==='member'&&d.personId===who.personId).map(d=>({...d,delivery:d.delivery?{...d.delivery,status:deliveries.find(row=>row.id===d.delivery.id)?.status ?? d.delivery.status}:null}));
}
