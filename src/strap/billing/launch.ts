import type { Transaction } from '../domain/store';
import { humanOwner, id, insist, list, now, person, record, text } from '../domain/types';
import { canonical, currentAgreement, mandateFor } from './model';

/** Staff can open the personal step, never supply its financial authorization. */
export function launchBillingAction(tx: Transaction,input: Record<string,unknown>,memberCommand: string,right: string) {
  humanOwner(tx.who);
  const agreement = memberCommand === 'billing.mandate.revoke' ? record(tx.state,input.id,'billingAgreement') : currentAgreement(tx.state,input.id);
  person(tx.state,agreement.personId);
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
