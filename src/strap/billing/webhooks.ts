import { loadSystem, Transaction } from '../domain/store';
import { DomainError, insist, now } from '../domain/types';
import { connection, digest, type BillingBindings, type Connection } from './model';
import { stripe } from './provider';
import { syncCheckout } from './checkout';

const encoder=new TextEncoder();
const fence=(tx: Transaction,c: Connection)=>tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_payment_connections WHERE id='billing' AND connection_id=? AND origin=? AND account_id=? AND key_digest=?) THEN 1 ELSE 0 END",c.connection_id,c.origin,c.account_id,c.key_digest));

async function signedBody(request: Request,secret: string) {
  const raw=await request.text();
  insist(encoder.encode(raw).length <= 1_000_000,'billing_webhook_too_large',413);
  const parts=(request.headers.get('stripe-signature') ?? '').split(',').map(v=>v.trim().split('='));
  const stamps=parts.filter(([k])=>k==='t'),stamp=stamps[0]?.[1];
  insist(stamps.length===1 && /^\d+$/.test(stamp ?? '') && Math.abs(Date.now()/1000-Number(stamp)) <= 300,'billing_webhook_signature_invalid',400);
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  let valid=false;
  for(const [name,value] of parts)if(name==='v1' && /^[a-f0-9]{64}$/i.test(value ?? '')) {
    const bytes=Uint8Array.from(value.match(/../g)!,v=>parseInt(v,16));
    if(await crypto.subtle.verify('HMAC',key,bytes,encoder.encode(stamp+'.'+raw)))valid=true;
  }
  insist(valid,'billing_webhook_signature_invalid',400);
  let body;
  try {body=JSON.parse(raw);}catch {throw new DomainError('billing_webhook_json_invalid');}
  insist(body && body.object==='event' && body.livemode===false && typeof body.id==='string' && body.id.length<=100 && typeof body.type==='string' && body.type.length<=100 && Number.isSafeInteger(body.created) && body.created>=0,'billing_webhook_event_invalid');
  return {body,hash:await digest(raw)};
}

/** The signed envelope is an inbox hint. Only account-scoped Stripe reads settle money. */
export async function billingWebhook(request: Request,env: BillingBindings) {
  try {
    insist(request.method==='POST','method_not_allowed',405);
    const url=new URL(request.url);
    insist(url.origin===env.AUTH_ORIGIN && (!request.headers.has('host') || request.headers.get('host')===url.host),'billing_webhook_origin_invalid',403);
    insist(env.STRIPE_BILLING_WEBHOOK_SECRET,'billing_webhook_not_configured',503);
    const c=await connection(env),{body,hash}=await signedBody(request,env.STRIPE_BILLING_WEBHOOK_SECRET);
    insist(!body.account || body.account===c.account_id,'billing_webhook_account_mismatch',403);
    const eventId='stripe-event:'+await digest({accountId:c.account_id,id:body.id});
    let loaded=await loadSystem(env.DB),tx=new Transaction(env.DB,loaded.state,loaded.who);
    const prior=tx.state.records.get(eventId)?.data;
    if(prior) {
      insist(prior.payloadHash===hash,'billing_webhook_event_changed',409);
      if(prior.status==='processed' || prior.status==='exception')return Response.json({received:true,status:prior.status},{headers:{'cache-control':'no-store'}});
    } else {
      fence(tx,c);
      tx.put('stripeEvent',{id:eventId,providerEventId:body.id,eventType:body.type,accountId:c.account_id,connectionId:c.connection_id,payloadHash:hash,createdAt:now(),providerCreatedAt:body.created,status:'queued'});
      await tx.commit();
    }
    let invoiceId: string|null=null,errorCode: string|null=null;
    try {
      const canonical=(await stripe(env,'/events/'+encodeURIComponent(body.id))).body;
      insist(canonical.id===body.id && canonical.object==='event' && canonical.type===body.type && canonical.livemode===false && (!canonical.account || canonical.account===c.account_id),'billing_webhook_provider_mismatch',409);
      const object=canonical.data?.object;
      insist(object && object.id===body.data?.object?.id && object.object===body.data?.object?.object,'billing_webhook_provider_mismatch',409);
      insist(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.expired','payment_intent.succeeded','payment_intent.payment_failed','invoice.paid','invoice.payment_succeeded','invoice.payment_failed'].includes(canonical.type),'billing_webhook_event_unsupported',409);
      const source=object.metadata?.strapInvoiceId;
      insist(typeof source==='string' && source.length<=100,'billing_webhook_invoice_unmatched',409);
      const current=await loadSystem(env.DB),invoice=current.state.records.get(source);
      insist(invoice?.kind==='stripeInvoice' && invoice.data.accountId===c.account_id,'billing_webhook_invoice_unmatched',409);
      // An unrelated provider object cannot claim another invoice's metadata.
      if(object.object==='checkout.session')insist(invoice.data.providerSessionId===object.id,'billing_webhook_source_mismatch',409);
      else if(object.object==='payment_intent' && invoice.data.paymentIntentId)insist(invoice.data.paymentIntentId===object.id,'billing_webhook_source_mismatch',409);
      else if(object.object==='invoice' && invoice.data.providerInvoiceId)insist(invoice.data.providerInvoiceId===object.id,'billing_webhook_source_mismatch',409);
      invoiceId=source;
      await syncCheckout(env,source,{kind:'webhook',id:canonical.id});
    } catch(error) {errorCode=error instanceof DomainError ? error.code : 'billing_webhook_provider_unavailable';}
    const fresh=await connection(env);
    insist(fresh.connection_id===c.connection_id && fresh.key_digest===c.key_digest,'billing_connection_changed',409);
    loaded=await loadSystem(env.DB);tx=new Transaction(env.DB,loaded.state,loaded.who);fence(tx,c);
    const saved=tx.state.records.get(eventId)!.data;
    tx.put('stripeEvent',{...saved,invoiceId,status:errorCode?'exception':'processed',errorCode,finishedAt:now()});
    if(errorCode)tx.put('billingException',{id:'billing-exception:'+await digest(eventId),eventId,invoiceId,accountId:c.account_id,code:errorCode,status:'open',createdAt:saved.createdAt,lastSeenAt:now()});
    await tx.commit();
    return Response.json({received:true,status:errorCode?'exception':'processed'},{headers:{'cache-control':'no-store'}});
  } catch(error) {
    return Response.json({error:error instanceof DomainError ? error.code : 'billing_webhook_failed'},{status:error instanceof DomainError ? error.status : 500,headers:{'cache-control':'no-store'}});
  }
}
