import type { Transaction } from '../domain/store';
import { humanOwner, id, insist, list, now, person, record, text } from '../domain/types';
import { requireStaffRight } from '../domain/staff-rights';
import { canonical, currentAgreement, mandateFor } from './model';

/** Staff can open the personal step, never supply its financial authorization. */
export function launchBillingAction(tx: Transaction,input: Record<string,unknown>,memberCommand: string,right: string) {
  if(right !== 'collection')humanOwner(tx.who);
  else requireStaffRight(tx.state,tx.who,'collection');
  if(!input.id) {
    const member=person(tx.state,input.personId);
    requireStaffRight(tx.state,tx.who,'collection',member.id,input.locationId ?? 'studio');
    const candidates=list(tx.state,'billingAgreement').filter(a=>a.personId===member.id && a.signature && mandateFor(tx.state,a.id)?.status==='accepted' && (tx.state.records.get(a.termsId)?.data.locationId ?? tx.state.records.get(tx.state.records.get(a.termsId)?.data.packId)?.data.locationId ?? 'studio')===(input.locationId ?? 'studio'));
    insist(candidates.length===1,'choose_one_current_billing_agreement',409);
    input={...input,id:candidates[0].id};
  }
  const target=record(tx.state,input.id,'billingAgreement');
  person(tx.state,target.personId);
  const terms=record(tx.state,target.termsId,'recurringTerms'),pack=record(tx.state,terms.packId,'pack');
  if(right === 'collection')requireStaffRight(tx.state,tx.who,'collection',target.personId,pack.locationId ?? 'studio');
  const agreement=memberCommand === 'billing.mandate.revoke' ? target : currentAgreement(tx.state,target.id);
  const requestId=text(input.requestId,'requestId',100), channel=input.channel ?? 'desk';
  insist(['desk','phone','inbox'].includes(String(channel)),'invalid_channel');
  const basis=canonical({agreementId:agreement.id,memberCommand,channel});
  const prior=list(tx.state,'billingActionLaunch').find(l=>l.actorId === tx.who.id && l.requestId === requestId);
  if(prior) { insist(prior.requestBasis === basis,'billing_request_changed',409); return prior; }
  const mandate=mandateFor(tx.state,agreement.id);
  if(memberCommand === 'billing.agreement.accept')insist(!agreement.signature,'billing_agreement_already_signed',409);
  else insist(agreement.signature && mandate?.status === 'accepted','payment_mandate_required',409);
  const before={status:agreement.status,documentHash:agreement.documentHash,financialHash:agreement.financialHash,mandateStatus:mandate?.status ?? null,methodAuthorized:mandate?.methodAuthorized ?? false};
  const launch={id:id(),personId:agreement.personId,agreementId:agreement.id,memberCommand,status:'member_action_required',url:'/signin?returnTo='+encodeURIComponent('/app/packs#billing-'+agreement.id),actorId:tx.who.id,createdAt:now(),requestId,requestBasis:basis,channel};
  tx.put('billingActionLaunch',launch);
  const command=memberCommand+'.launch';
  tx.put('staffAction',{id:'billing-launch:'+launch.id,command,action:command,personId:agreement.personId,actorId:tx.who.id,actorRole:tx.who.role,staffMade:true,right,channel,at:launch.createdAt,before,after:{...before,launchId:launch.id,status:launch.status,memberCommand},requestId});
  return launch;
}
