import { load, Transaction } from '../domain/store';
import { id, insist, list, now, text, type Actor } from '../domain/types';
import { canonical, connection, currentAgreement, mandateFor, ownMember, type BillingBindings } from './model';

export const purchaseConsentText='I allow studio staff to initiate charges to this exact saved card for purchases I request in the selected channels. This is separate from recurring membership payments. It does not approve a purchase, price change or automatic charge. I can withdraw this permission immediately; earlier purchases and debt remain unchanged.';

/** Only the member grants or withdraws purchase permission; staff open the personal door. */
export async function purchaseConsent(env: BillingBindings,who: Actor,input: Record<string,unknown>) {
  const loaded=await load(env.DB,who),tx=new Transaction(env.DB,loaded.state,loaded.who);
  const row=tx.state.records.get(text(input.methodId,'methodId',200));
  insist(row?.kind==='storedPaymentMethod' && !row.data.erased,'billing_method_not_found',404);
  const method=row.data;
  ownMember(tx.state,tx.who,method.personId);
  insist(typeof input.enabled==='boolean' && input.confirm===true,'billing_purchase_confirmation_required');
  insist(Number.isInteger(input.revision) && Number(input.revision)>=0,'billing_purchase_revision_required');
  const contexts=input.enabled ? input.contexts : [];
  insist(Array.isArray(contexts) && (!input.enabled || contexts.length>0) && contexts.length<=2 && contexts.every(v=>typeof v==='string' && ['in-person','phone'].includes(v)) && new Set(contexts).size===contexts.length,'billing_purchase_context_required');
  const selected=[...contexts].sort(),requestId=text(input.requestId,'requestId',100),basis=canonical({methodId:method.id,enabled:input.enabled,contexts:selected,revision:input.revision,confirm:input.confirm});
  const current=list(tx.state,'billingPurchaseConsent').find(r=>r.methodId===method.id),prior=list(tx.state,'billingPurchaseConsentEvent').find(r=>r.actorId===tx.who.id && r.requestId===requestId);
  if(input.enabled) {
    const agreement=currentAgreement(tx.state,method.agreementId),mandate=mandateFor(tx.state,agreement.id),c=await connection(env);
    insist(agreement.signature && mandate?.status==='accepted' && ['authorized','superseded'].includes(method.status) && method.mandateId===mandate.id && method.connectionId===c.connection_id && method.accountId===c.account_id,'billing_method_unavailable',409);
    tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_payment_connections WHERE id='billing' AND connection_id=? AND origin=? AND account_id=? AND key_digest=?) THEN 1 ELSE 0 END",c.connection_id,c.origin,c.account_id,c.key_digest));
  }
  if(prior) {
    insist(prior.requestBasis===basis,'billing_request_changed',409);
    insist(current?.revision===prior.after.revision,'billing_purchase_permission_changed',409);
    return current;
  }
  insist((current?.revision ?? 0)===input.revision,'billing_purchase_permission_changed',409);
  const at=now(),result={id:current?.id ?? 'billing-purchase-consent:'+method.id,personId:method.personId,agreementId:method.agreementId,mandateId:method.mandateId,methodId:method.id,status:input.enabled?'authorized':'withdrawn',contexts:selected,revision:Number(input.revision)+1,affirmationText:purchaseConsentText,actorId:tx.who.id,channel:'member-account',updatedAt:at,connectionId:method.connectionId};
  tx.put('billingPurchaseConsent',result);
  tx.put('billingPurchaseConsentEvent',{id:id(),personId:method.personId,agreementId:method.agreementId,mandateId:method.mandateId,methodId:method.id,consentId:result.id,actorId:tx.who.id,actorRole:tx.who.role,channel:'member-account',at,requestId,requestBasis:basis,affirmationText:purchaseConsentText,before:{status:current?.status ?? 'not-granted',contexts:current?.contexts ?? [],revision:current?.revision ?? 0},after:{status:result.status,contexts:selected,revision:result.revision},staffMade:false});
  await tx.commit();return result;
}

/** A removal stops every kind of Strap use without rewriting the personal grant. */
export function endPurchaseConsent(tx: Transaction,methodId: string,reason: string,at: string) {
  const current=list(tx.state,'billingPurchaseConsent').find(r=>r.methodId===methodId);
  if(!current || current.status!=='authorized')return;
  const after={status:'withdrawn',contexts:[],revision:current.revision+1};
  tx.put('billingPurchaseConsent',{...current,...after,updatedAt:at,endedReason:reason});
  tx.put('billingPurchaseConsentEvent',{id:id(),personId:current.personId,agreementId:current.agreementId,mandateId:current.mandateId,methodId,consentId:current.id,actorId:tx.who.id,actorRole:tx.who.role,channel:'method-removal',at,reason,before:{status:current.status,contexts:current.contexts,revision:current.revision},after,staffMade:tx.who.role!=='member'});
}
