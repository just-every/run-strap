import { load, Transaction } from '../domain/store';
import { DomainError, humanOwner, insist, integer, list, now, person, record, text, type Actor, type RecordData } from '../domain/types';
import { connection, digest, type BillingBindings, type Connection, type Json } from './model';
import { ProviderFailure, stripe } from './provider';
import { invoiceCharges, lineAllocations } from './invoice-sources';

function fence(tx:Transaction,c:Connection) {
  tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_payment_connections WHERE id='billing' AND connection_id=? AND origin=? AND account_id=? AND key_digest=?) THEN 1 ELSE 0 END",c.connection_id,c.origin,c.account_id,c.key_digest));
}
function authorize(tx:Transaction,r:RecordData,c:Connection) {
  humanOwner(tx.who);person(tx.state,r.personId);
  insist(c.account_id===r.accountId,'invoice_refund_account_changed',409);
  insist(list(tx.state,'billingConnectionReview').some(v=>v.connectionId===c.connection_id && v.ready && v.approvedBy && v.accountId===c.account_id),'billing_connection_review_required',409);fence(tx,c);
}
function validate(body:Json,r:RecordData) {
  insist(body.object==='refund' && typeof body.id==='string' && body.currency==='usd' && body.amount===r.amountCents && body.charge===r.providerChargeId && body.payment_intent===r.paymentIntentId && body.metadata?.strapRefundId===r.id,'invoice_refund_provider_mismatch',502);
  insist(['pending','requires_action','succeeded','failed','canceled'].includes(body.status),'invoice_refund_status_invalid',502);
}
async function finish(env:BillingBindings,who:Actor,r:RecordData,c:Connection,body:Json|null,error:string|null) {
  if(body)validate(body,r);
  const fresh=await load(env.DB,who),tx=new Transaction(env.DB,fresh.state,fresh.who),current=await connection(env),saved=record(tx.state,r.id,'invoiceRefund');
  insist(current.connection_id===c.connection_id,'billing_connection_changed',409);authorize(tx,saved,current);
  const status=body?.status==='canceled'?'failed':body?.status==='requires_action'?'pending':body?.status ?? (error==='provider_refused'?'failed':'uncertain');
  insist(saved.status!=='succeeded' || status==='succeeded','invoice_refund_cannot_regress',409);
  let creditChargeId=saved.creditChargeId ?? null,paymentId=saved.refundPaymentId ?? null;
  if(status==='succeeded' && !creditChargeId) {
    creditChargeId='invoice-refund-credit:'+saved.id;paymentId='invoice-refund-payment:'+saved.id;
    tx.put('charge',{id:creditChargeId,personId:saved.personId,packId:saved.packId,locationId:saved.locationId,invoiceRefundId:saved.id,reversesChargeId:saved.lineId,amountCents:-saved.amountCents,reason:'invoice_line_refund',createdAt:now(),createdBy:who.id});
    tx.put('payment',{id:paymentId,personId:saved.personId,packId:saved.packId,locationId:saved.locationId,invoiceRefundId:saved.id,originalPaymentId:saved.originalPaymentId,chargeId:creditChargeId,amountCents:-saved.amountCents,reference:'stripe-refund:'+body!.id,providerRefundId:body!.id,tender:'stripe-test-card',collection:'stripe-test-refund',createdAt:now(),recordedBy:who.id});
  }
  const result={...saved,status,providerRefundId:body?.id ?? saved.providerRefundId ?? null,errorCode:error,creditChargeId,refundPaymentId:paymentId,updatedAt:now()};
  tx.put('invoiceRefund',result);await tx.commit();return result;
}
export async function refundInvoiceLine(env:BillingBindings,who:Actor,input:Record<string,unknown>) {
  const loaded=await load(env.DB,who),tx=new Transaction(env.DB,loaded.state,loaded.who);humanOwner(tx.who);
  const pack=record(tx.state,input.packId,'pack');person(tx.state,pack.personId);
  const line=record(tx.state,input.lineId,'charge'),amountCents=integer(input.amountCents,'amountCents',1,100_000_000),reason=text(input.reason,'reason',1000),requestId=text(input.requestId,'requestId',100);
  insist(input.confirm===true,'invoice_refund_confirmation_required');
  const id='invoice-refund:'+await digest({actorId:who.id,requestId}),basis=JSON.stringify({packId:pack.id,lineId:line.id,amountCents,reason}),prior=tx.state.records.get(id)?.data;
  const c=await connection(env);
  if(prior){authorize(tx,prior,c);insist(prior.requestBasis===basis,'invoice_refund_request_changed',409);return prior;}
  insist(invoiceCharges(tx.state,pack.id).some(l=>l.id===line.id) && line.amountCents>0 && line.personId===pack.personId && !line.reason?.startsWith('sales_tax'),'invoice_refund_line_unavailable',409);
  insist(!list(tx.state,'charge').some(l=>l.reversesChargeId===line.id && !l.invoiceRefundId),'invoice_line_already_credited',409);
  const reserved=list(tx.state,'invoiceRefund').filter(r=>!['failed'].includes(r.status));
  insist(reserved.filter(r=>r.lineId===line.id).reduce((n,r)=>n+r.amountCents,0)+amountCents<=line.amountCents,'invoice_line_refund_exceeded',409);
  const allocation=lineAllocations(tx.state,pack.id).find(a=>a.chargeId===line.id && tx.state.records.get(a.paymentId)?.data.collection==='stripe-test-checkout' && a.amountCents-reserved.filter(r=>r.lineId===line.id && r.originalPaymentId===a.paymentId).reduce((n,r)=>n+r.amountCents,0)>=amountCents);
  insist(allocation,'invoice_collected_line_required',409);
  const payment=record(tx.state,allocation.paymentId,'payment');
  const saved={id,packId:pack.id,personId:pack.personId,locationId:pack.locationId ?? 'studio',lineId:line.id,originalPaymentId:payment.id,accountId:payment.accountId,providerChargeId:payment.providerChargeId,paymentIntentId:payment.paymentIntentId,amountCents,reason,requestId,requestBasis:basis,actorId:who.id,status:'creating',tender:'stripe-test-card',createdAt:now()};
  authorize(tx,saved,c);tx.put('invoiceRefund',saved);await tx.commit();
  let body:Json|null=null,error:string|null=null;
  try {body=(await stripe(env,'/refunds',new URLSearchParams({charge:payment.providerChargeId,amount:String(amountCents),'metadata[strapRefundId]':id}),id)).body;validate(body,saved);}
  catch(e){body=null;error=e instanceof ProviderFailure && e.status>=400 && e.status<500?'provider_refused':e instanceof DomainError?e.code:'invoice_refund_outcome_unknown';}
  return finish(env,who,saved,c,body,error);
}
export async function reconcileInvoiceRefund(env:BillingBindings,who:Actor,input:Record<string,unknown>) {
  const loaded=await load(env.DB,who),tx=new Transaction(env.DB,loaded.state,loaded.who),r=record(tx.state,input.id,'invoiceRefund'),c=await connection(env);authorize(tx,r,c);
  text(input.requestId,'requestId',100);
  let body:Json;
  if(r.providerRefundId)body=(await stripe(env,'/refunds/'+encodeURIComponent(r.providerRefundId))).body;
  else {
    const result=(await stripe(env,'/refunds?charge='+encodeURIComponent(r.providerChargeId)+'&limit=100')).body;
    insist(Array.isArray(result.data) && result.has_more===false,'invoice_refund_discovery_incomplete',409);
    const matches=result.data.filter((b:Json)=>b.metadata?.strapRefundId===r.id);insist(matches.length===1,'invoice_refund_discovery_unavailable',409);body=matches[0];
  }
  return finish(env,who,r,c,body,null);
}
