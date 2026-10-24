import { humanOwner, id, insist, integer, list, now, record, text, type Actor, type State } from './types';
import type { Transaction } from './store';
import { contractNotice } from './contract-billing';

/** Explicit owner scheduling: a proposal alone never changes an accepted agreement. */
export async function scheduleRenewalDisclosure(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const requestId=text(input.requestId,'requestId',100), basis=JSON.stringify(input);
  const prior=list(tx.state,'renewalDisclosure').find(d=>d.createdBy===tx.who.id&&d.requestId===requestId);
  if(prior){insist(prior.requestBasis===basis,'disclosure_request_changed',409);return prior;}
  if(input.packId&&!input.termsId)return schedulePackExpiry(tx,input,requestId,basis);
  const terms=record(tx.state,input.termsId,'recurringTerms');
  insist(terms.status==='active'&&terms.acceptedAt,'accepted_active_agreement_required',409);
  const leadDays=integer(input.leadDays,'leadDays',15,365),dueAt=terms.nextRenewalAt;
  const sendAt=new Date(Date.parse(dueAt)-leadDays*86400000).toISOString();
  insist(sendAt>now(),'disclosure_lead_time_already_passed',409);
  const proposedAmountCents=input.proposedAmountCents===undefined ? null : integer(input.proposedAmountCents,'proposedAmountCents',0,100_000_000);
  insist(proposedAmountCents===null||proposedAmountCents!==terms.amountCents,'price_change_requires_new_amount',409);
  insist(!list(tx.state,'renewalDisclosure').some(d=>d.termsId===terms.id&&d.dueAt===dueAt&&['scheduled','delivered'].includes(d.status)),'renewal_disclosure_exists',409);
  const dispatchConnectionId=await disclosureConnection(tx);
  const disclosure={dispatchConnectionId,kind:'renewal',id:id(),personId:terms.personId,termsId:terms.id,packId:terms.currentPackId,dueAt,sendAt,leadDays,proposedAmountCents,
    acceptedTermsKey:terms.key,acceptedAt:terms.acceptedAt,acceptedBy:terms.acceptedBy,currentAmountCents:terms.amountCents,intervalMonths:terms.intervalMonths,
    stopPath:terms.stopPath,status:'scheduled',createdAt:now(),createdBy:tx.who.id,requestId,requestBasis:basis,
    policy:'A price proposal alone never changes this agreement. A future price requires your exact personal acceptance before its stated due date. Without acceptance your existing price continues. This notice alone cannot enroll you. No payment is authorized or collected.'};
  const consent=proposedAmountCents===null?null:`I agree to studio invoices of $${(proposedAmountCents/100).toFixed(2)} every ${terms.intervalMonths} calendar month(s), starting ${dueAt} (${terms.timeZone}) and continuing until stopped. All other plan terms stay unchanged. Stop immediately without a reason: ${terms.stopPath}. This authorizes studio-balance debt only, never card or bank collection.`;
  const saved={...disclosure,consent,priorPriceDisclosureId:terms.currentPriceDisclosureId ?? null,key:JSON.stringify([disclosure.id,terms.id,terms.key,terms.currentPackId,dueAt,terms.amountCents,proposedAmountCents,consent])};
  tx.put('renewalDisclosure',saved);return saved;
}
export function cancelRenewalDisclosure(tx: Transaction,input:Record<string,unknown>){
  humanOwner(tx.who);const d=record(tx.state,input.id,'renewalDisclosure');
  if(d.status==='cancelled')return d;
  insist(d.status==='scheduled','disclosure_already_closed',409);
  insist(!d.acceptedAtPrice,'accepted_price_cannot_be_withdrawn_by_studio',409);
  const closed={...d,status:'cancelled',cancelledAt:now(),cancelledBy:tx.who.id};tx.put('renewalDisclosure',closed);return closed;
}
/** Uses the existing atomic reservation and configured Base sender, once per disclosure. */
export async function deliverRenewalDisclosures(tx:Transaction){
  const disclosureEpoch=await tx.db.prepare("SELECT connection_id,origin FROM st_disclosure_connections WHERE id='disclosures'").first<{connection_id:string;origin:string}>();
  const connection=await tx.db.prepare("SELECT connection_id,origin FROM st_contract_connections WHERE id='billing'").first<{connection_id:string;origin:string}>();
  for(const d of list(tx.state,'renewalDisclosure').filter(d=>d.status==='scheduled'&&d.sendAt<=now())){
    if(!disclosureEpoch||disclosureEpoch.connection_id!==d.dispatchConnectionId||disclosureEpoch.origin!==tx.notices.origin){tx.put('renewalDisclosure',{...d,status:'stale',closedAt:now()});continue;}
    if(d.kind==='pack-expiry'){deliverPackExpiry(tx,d);continue;}
    const terms=tx.state.records.get(d.termsId)?.data;
    if(!connection||connection.connection_id!==terms?.connectionId||connection.origin!==tx.notices.origin||terms?.billingOrigin!==tx.notices.origin||!terms||terms.status!=='active'||terms.key!==d.acceptedTermsKey||terms.nextRenewalAt!==d.dueAt||terms.currentPackId!==d.packId||terms.amountCents!==d.currentAmountCents||now()>=d.dueAt){tx.put('renewalDisclosure',{...d,status:'stale',closedAt:now()});continue;}
    tx.reached(d.sendAt);tx.future(d.dueAt);
    const body=`Your next studio invoice is due ${d.dueAt}: $${(d.currentAmountCents/100).toFixed(2)} every ${d.intervalMonths} calendar month(s). `
      +(d.proposedAmountCents===null?'':`The studio proposes $${(d.proposedAmountCents/100).toFixed(2)} starting at this renewal. ${d.consent} `)
      +`${d.policy} Stop immediately without a reason after signing in: ${d.stopPath}. Access continues to the current paid term end.`;
    const delivery=contractNotice(tx,`renewal-disclosure:${d.id}`,d.personId,d.proposedAmountCents===null?'Upcoming renewal disclosure':'Proposed price change disclosure',body);
    tx.put('renewalDisclosure',{...d,status:'delivered',deliveredAt:now(),body,noticeId:`notice:renewal-disclosure:${d.id}`,delivery});
  }
}
export async function renewalDisclosuresSnapshot(db:D1Database,state:State,who:Actor){
  const deliveries=(await db.prepare("SELECT id,status FROM st_notice_deliveries WHERE source_id LIKE 'renewal-disclosure:%'").all<{id:string;status:string}>()).results;
  return list(state,'renewalDisclosure').filter(d=>who.role==='owner'||who.role==='member'&&d.personId===who.personId).map(d=>({...d,canAccept:d.status==='delivered'&&d.proposedAmountCents!==null&&!d.acceptedAtPrice&&d.dueAt>now()&&state.records.get(d.termsId)?.data.status==='active'&&state.records.get(d.termsId)?.data.nextRenewalAt===d.dueAt&&state.records.get(d.termsId)?.data.currentPackId===d.packId,delivery:d.delivery?{...d.delivery,status:deliveries.find(row=>row.id===d.delivery.id)?.status ?? d.delivery.status}:null}));
}

/** A staff invitation never substitutes for the member's personal price acceptance. */
export function launchDisclosureAcceptance(tx:Transaction,input:Record<string,unknown>){
  humanOwner(tx.who);const d=record(tx.state,input.id,'renewalDisclosure');
  insist(d.status==='delivered'&&d.proposedAmountCents!==null&&d.dueAt>now(),'disclosure_not_accepting',409);
  return {id:id(),personId:d.personId,previewId:d.id,purpose:'renewal-price',status:'member_action_required',url:'/signin?returnTo=%2Fapp%2Fpacks%23freezes'};
}
export function acceptDisclosurePrice(tx:Transaction,input:Record<string,unknown>){
  insist(tx.who.role==='member','member_acceptance_required',403);
  const d=record(tx.state,input.id,'renewalDisclosure');insist(d.personId===tx.who.personId,'renewalDisclosure_not_found',404);
  insist(input.key===d.key,'preview_changed',409);
  if(d.acceptedAtPrice){insist(d.acceptedByPrice===tx.who.id,'member_acceptance_required',403);return d;}
  insist(d.status==='delivered'&&d.proposedAmountCents!==null&&d.dueAt>now(),'disclosure_not_accepting',409);
  const terms=record(tx.state,d.termsId,'recurringTerms'),pack=record(tx.state,d.packId,'pack');
  insist(terms.status==='active'&&terms.key===d.acceptedTermsKey&&terms.nextRenewalAt===d.dueAt&&terms.currentPackId===d.packId&&terms.amountCents===d.currentAmountCents&&pack.expiresAt===d.dueAt&&(terms.currentPriceDisclosureId ?? null)===d.priorPriceDisclosureId,'disclosure_source_changed',409);
  tx.future(d.dueAt);
  const accepted={...d,acceptedAtPrice:now(),acceptedByPrice:tx.who.id,acceptanceKey:d.key,acceptanceText:d.consent,acceptanceChannel:'member-self-service'};
  tx.put('renewalDisclosure',accepted);
  contractNotice(tx,`renewal-price-acceptance:${d.id}`,d.personId,'Renewal price accepted',d.consent);
  return accepted;
}

async function disclosureConnection(tx:Transaction){
  const origin=text(tx.notices.origin,'disclosure_origin',2000);
  const prior=await tx.db.prepare("SELECT connection_id,origin FROM st_disclosure_connections WHERE id='disclosures'").first<{connection_id:string;origin:string}>();
  if(prior?.origin===origin)return prior.connection_id;
  const epoch=id();tx.sql.push(tx.statement("INSERT INTO st_disclosure_connections(id,connection_id,origin,approved_by,approved_at) VALUES('disclosures',?,?,?,?) ON CONFLICT(id) DO UPDATE SET connection_id=excluded.connection_id,origin=excluded.origin,approved_by=excluded.approved_by,approved_at=excluded.approved_at",epoch,origin,tx.who.id,now()));return epoch;
}
function renewalPending(state:State,packId:string){return list(state,'recurringTerms').some(t=>t.currentPackId===packId&&t.status==='active')||list(state,'planChange').some(c=>c.packId===packId&&c.mode==='renewal'&&c.status==='accepted');}
async function schedulePackExpiry(tx:Transaction,input:Record<string,unknown>,requestId:string,requestBasis:string){
  const pack=record(tx.state,input.packId,'pack'),leadDays=integer(input.leadDays,'leadDays',1,365);
  insist(!renewalPending(tx.state,pack.id),'pack_has_accepted_renewal',409);
  insist(input.proposedAmountCents===undefined,'pack_expiry_notice_is_not_a_price_change',409);
  const sendAt=new Date(Date.parse(pack.expiresAt)-leadDays*86400000).toISOString();insist(sendAt>now(),'disclosure_lead_time_already_passed',409);
  insist(!list(tx.state,'renewalDisclosure').some(d=>d.packId===pack.id&&d.dueAt===pack.expiresAt&&['scheduled','delivered'].includes(d.status)),'renewal_disclosure_exists',409);
  const dispatchConnectionId=await disclosureConnection(tx);
  const disclosure={id:id(),kind:'pack-expiry',dispatchConnectionId,personId:pack.personId,packId:pack.id,termsId:null,dueAt:pack.expiresAt,sendAt,leadDays,currentAmountCents:pack.amountCents,proposedAmountCents:null,intervalMonths:null,
    purchaseBasis:{draftId:pack.draftId,createdAt:pack.createdAt,amountCents:pack.amountCents,expiresAt:pack.expiresAt},
    stopPath:'/app/packs#pack-'+encodeURIComponent(pack.id),status:'scheduled',createdAt:now(),createdBy:tx.who.id,requestId,requestBasis,
    policy:'This finite pack expires at its recorded term end. No renewal has been accepted and this notice creates no invoice or payment.'};
  tx.put('renewalDisclosure',disclosure);return disclosure;
}
function deliverPackExpiry(tx:Transaction,d:ReturnType<typeof record>){
  const pack=tx.state.records.get(d.packId)?.data;
  if(!pack||pack.expiresAt!==d.dueAt||renewalPending(tx.state,pack.id)||now()>=d.dueAt){tx.put('renewalDisclosure',{...d,status:'stale',closedAt:now()});return;}
  tx.reached(d.sendAt);tx.future(d.dueAt);
  const body=`Your finite pack expires ${d.dueAt}. ${d.policy} Review its retained purchase and remaining visits after signing in: ${d.stopPath}.`;
  const delivery=contractNotice(tx,`renewal-disclosure:${d.id}`,d.personId,'Upcoming pack expiry',body);
  tx.put('renewalDisclosure',{...d,status:'delivered',deliveredAt:now(),body,noticeId:`notice:renewal-disclosure:${d.id}`,delivery});
}
