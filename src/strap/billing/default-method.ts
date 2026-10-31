import { requireStaffRight } from '../domain/staff-rights';
import { staffChannel } from '../domain/staff-actions';
import { load, Transaction } from '../domain/store';
import { id, insist, list, now, person, record, text, type Actor } from '../domain/types';
import { canonical, connection, currentAgreement, mandateFor, ownMember, type BillingBindings } from './model';

/** Choosing a retained personal authorization changes no provider object or debt. */
export async function defaultMethodCommand(env: BillingBindings,who: Actor,input: Record<string,unknown>,mode: 'request'|'member'|'staff') {
  const loaded=await load(env.DB,who),tx=new Transaction(env.DB,loaded.state,loaded.who);
  const request=mode==='request' ? null : record(tx.state,input.id,'billingMethodDefaultRequest');
  insist(!request?.erased && request?.status!=='retired','billing_default_request_retired',409);
  const methodRow=tx.state.records.get(text(mode==='request'?input.methodId:request!.methodId,'methodId',200));
  insist(methodRow?.kind==='storedPaymentMethod','billing_method_not_found',404);
  const method=methodRow.data;
  person(tx.state,method.personId);
  const agreement=currentAgreement(tx.state,method.agreementId),mandate=mandateFor(tx.state,agreement.id);
  if(mode==='staff') {
    const terms=record(tx.state,agreement.termsId,'recurringTerms'),pack=record(tx.state,terms.currentPackId,'pack');
    requireStaffRight(tx.state,tx.who,'collection',method.personId,pack.locationId ?? 'studio');
  } else ownMember(tx.state,tx.who,method.personId);
  insist(agreement.signature && mandate?.status==='accepted','payment_mandate_required',409);
  const c=await connection(env);
  insist(!method.erased && ['authorized','superseded'].includes(method.status) && method.mandateId===mandate.id && method.personId===agreement.personId && method.connectionId===c.connection_id && method.accountId===c.account_id,'billing_method_unavailable',409);
  insist(input.confirm===true,'billing_default_confirmation_required');
  const requestId=text(input.requestId,'requestId',100),at=now();
  tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_payment_connections WHERE id='billing' AND connection_id=? AND origin=? AND account_id=? AND key_digest=?) THEN 1 ELSE 0 END",c.connection_id,c.origin,c.account_id,c.key_digest));
  if(mode==='request') {
    const basis=canonical({methodId:method.id,confirm:input.confirm});
    const prior=list(tx.state,'billingMethodDefaultRequest').find(r=>r.actorId===tx.who.id && r.requestId===requestId);
    if(prior) {insist(prior.requestBasis===basis,'billing_request_changed',409);return prior;}
    insist(mandate.methodId!==method.id,'billing_method_already_default',409);
    const result={id:id(),personId:method.personId,agreementId:agreement.id,methodId:method.id,brand:method.brand,last4:method.last4,mandateId:mandate.id,sourceMethodId:mandate.methodId ?? null,methodEpoch:mandate.methodEpoch ?? 0,financialHash:mandate.financialHash,connectionId:c.connection_id,actorId:tx.who.id,requestedAt:at,requestId,requestBasis:basis,status:'requested'};
    tx.put('billingMethodDefaultRequest',result);
    tx.put('storedPaymentMethod',{...method,defaultRequestId:result.id});
    await tx.commit();return result;
  }
  const channel=mode==='staff'?staffChannel(input):'member-account',basis=canonical({id:request!.id,confirm:input.confirm,channel});
  const prior=list(tx.state,'billingMethodDefaultChange').find(r=>r.actorId===tx.who.id && r.requestId===requestId);
  if(prior) {insist(prior.requestBasis===basis,'billing_request_changed',409);return prior;}
  const existing=list(tx.state,'billingMethodDefaultChange').find(r=>r.defaultRequestId===request!.id);
  if(existing)return existing;
  insist(request!.status==='requested' && method.defaultRequestId===request!.id && request!.personId===method.personId && request!.mandateId===mandate.id && request!.connectionId===c.connection_id && request!.financialHash===mandate.financialHash && request!.sourceMethodId===(mandate.methodId ?? null) && request!.methodEpoch===(mandate.methodEpoch ?? 0),'billing_default_request_changed',409);
  const previousMethod=mandate.methodId ? tx.state.records.get(mandate.methodId)?.data : null;
  const before={methodId:mandate.methodId ?? null,methodAuthorized:mandate.methodAuthorized===true,brand:previousMethod?.brand ?? null,last4:previousMethod?.last4 ?? null},after={methodId:method.id,methodAuthorized:true,brand:method.brand,last4:method.last4};
  if(mandate.methodId) {
    const previous=tx.state.records.get(mandate.methodId)?.data;
    insist(previous?.mandateId===mandate.id,'billing_method_unavailable',409);
    tx.put('storedPaymentMethod',{...previous,status:'superseded',supersededBy:method.id,supersededAt:at});
  }
  tx.put('storedPaymentMethod',{...method,status:'authorized',supersededBy:null,supersededAt:null,selectedAt:at});
  tx.put('paymentMandate',{...mandate,methodId:method.id,methodAuthorized:true,connectionId:c.connection_id,methodAuthorizedAt:at,methodEpoch:(mandate.methodEpoch ?? 0)+1});
  tx.put('billingAgreement',{...agreement,status:'signed-method-authorized'});
  for(const setup of list(tx.state,'billingSetup').filter(s=>s.mandateId===mandate.id && s.status==='awaiting-member'))tx.put('billingSetup',{...setup,status:'invalidated',invalidatedAt:at,reason:'default_changed'});
  const result={id:'billing-default:'+request!.id,personId:method.personId,agreementId:agreement.id,mandateId:mandate.id,methodId:method.id,defaultRequestId:request!.id,requestedBy:request!.actorId,requestedAt:request!.requestedAt,actorId:tx.who.id,actorRole:tx.who.role,staffMade:mode==='staff',channel,at,requestId,requestBasis:basis,before,after};
  tx.put('billingMethodDefaultChange',result);
  tx.put('billingMethodDefaultRequest',{...request!,status:'selected',selectedAt:at,changeId:result.id});
  tx.put('billingConsentEvent',{...result,id:'billing-default-consent:'+request!.id});
  if(mode==='staff')tx.put('staffAction',{...result,id:'billing-default-audit:'+request!.id,command:'billing.method.default.staff',action:'billing.method.default.staff',right:'collection'});
  await tx.commit();return result;
}
