import { endPurchaseConsent } from './purchase-consent';
import { requireStaffRight } from '../domain/staff-rights';
import { staffChannel } from '../domain/staff-actions';
import type { Transaction } from '../domain/store';
import { id, insist, list, now, person, record, text } from '../domain/types';
import { canonical, mandateFor, ownMember } from './model';

const storedMethod=(tx: Transaction,value: unknown)=>{
  const row=tx.state.records.get(text(value,'methodId',200));
  insist(row?.kind==='storedPaymentMethod','billing_method_not_found',404);return row.data;
};

/** A staff removal consumes the member's exact recorded request, never studio initiative. */
export function requestMethodRemoval(tx: Transaction,input: Record<string,unknown>) {
  const method=storedMethod(tx,input.methodId);
  ownMember(tx.state,tx.who,method.personId);
  insist(input.confirm === true,'billing_removal_confirmation_required');
  const requestId=text(input.requestId,'requestId',100),basis=canonical({methodId:method.id,confirm:input.confirm});
  const prior=list(tx.state,'billingMethodRemovalRequest').find(r=>r.actorId===tx.who.id && r.requestId===requestId);
  if(prior) { insist(prior.requestBasis===basis,'billing_request_changed',409);return prior; }
  insist(method.status!=='removed','billing_method_already_removed',409);
  const request={id:id(),personId:method.personId,agreementId:method.agreementId,methodId:method.id,brand:method.brand,last4:method.last4,sourceStatus:method.status,actorId:tx.who.id,requestedAt:now(),requestId,requestBasis:basis,status:'requested'};
  tx.put('billingMethodRemovalRequest',request);
  tx.put('storedPaymentMethod',{...method,removalRequestId:request.id});
  return request;
}

export function removeMethod(tx: Transaction,input: Record<string,unknown>,staff=false) {
  const request=record(tx.state,input.id,'billingMethodRemovalRequest');
  insist(!request.erased && request.status!=='retired','billing_removal_request_retired',409);
  const method=storedMethod(tx,request.methodId);
  const agreement=record(tx.state,method.agreementId,'billingAgreement');
  person(tx.state,method.personId);
  if(staff) {
    const terms=record(tx.state,agreement.termsId,'recurringTerms'),pack=record(tx.state,terms.currentPackId,'pack');
    requireStaffRight(tx.state,tx.who,'collection',method.personId,pack.locationId ?? 'studio');
  } else ownMember(tx.state,tx.who,method.personId);
  insist(input.confirm===true,'billing_removal_confirmation_required');
  const requestId=text(input.requestId,'requestId',100),channel=staff ? staffChannel(input) : 'member-account';
  const basis=canonical({id:request.id,confirm:input.confirm,channel});
  const prior=list(tx.state,'billingMethodRemoval').find(r=>r.actorId===tx.who.id && r.requestId===requestId);
  if(prior) { insist(prior.requestBasis===basis,'billing_request_changed',409);return prior; }
  insist(request.personId===method.personId && request.agreementId===agreement.id && method.removalRequestId===request.id,'billing_removal_request_changed',409);
  const existing=list(tx.state,'billingMethodRemoval').find(r=>r.methodId===method.id);
  if(existing)return existing;
  insist(request.status==='requested' && method.status===request.sourceStatus && method.status!=='removed','billing_method_changed',409);
  const mandate=mandateFor(tx.state,agreement.id),at=now(),wasDefault=mandate?.methodId===method.id;
  const before={methodId:method.id,status:method.status,methodAuthorized:wasDefault && mandate?.methodAuthorized===true};
  tx.put('storedPaymentMethod',{...method,status:'removed',removedAt:at,removedBy:tx.who.id,removalChannel:channel});
  if(wasDefault) {
    tx.put('paymentMandate',{...mandate!,methodAuthorized:false,methodId:null,connectionId:null,methodEpoch:(mandate!.methodEpoch ?? 0)+1});
    if(mandate!.status==='accepted')tx.put('billingAgreement',{...agreement,status:'signed-awaiting-method'});
    for(const setup of list(tx.state,'billingSetup').filter(s=>s.mandateId===mandate!.id && s.status==='awaiting-member'))tx.put('billingSetup',{...setup,status:'invalidated',invalidatedAt:at,reason:'method_removed'});
  }
  endPurchaseConsent(tx,method.id,'method_removed',at);
  const result={id:'billing-removal:'+request.id,personId:method.personId,agreementId:agreement.id,methodId:method.id,removalRequestId:request.id,requestedBy:request.actorId,requestedAt:request.requestedAt,actorId:tx.who.id,actorRole:tx.who.role,staffMade:staff,channel,at,requestId,requestBasis:basis,before,after:{methodId:method.id,status:'removed',methodAuthorized:false},providerDeletion:false};
  tx.put('billingMethodRemoval',result);
  tx.put('billingMethodRemovalRequest',{...request,status:'removed',removedAt:at,removalId:result.id});
  tx.put('billingConsentEvent',{id:'billing-removal-consent:'+request.id,personId:method.personId,agreementId:agreement.id,mandateId:method.mandateId,actorId:tx.who.id,actorRole:tx.who.role,channel,at,before,after:result.after,staffMade:staff,removalRequestId:request.id});
  if(staff)tx.put('staffAction',{...result,id:'billing-removal-audit:'+request.id,command:'billing.method.remove.staff',action:'billing.method.remove.staff',right:'collection'});
  return result;
}
