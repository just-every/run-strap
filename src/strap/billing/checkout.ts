import { balance } from '../domain/money';
import { load, loadSystem, Transaction } from '../domain/store';
import { DomainError, humanOwner, insist, list, now, person, record, text, type Actor, type RecordData, type State } from '../domain/types';
import { connection, digest, keyDigest, type BillingBindings, type Connection, type Json } from './model';
import { hostedURL, stripe } from './provider';
import { widgetAdult, widgetSelection } from '../domain/booking-widget';
import { eligiblePacks } from '../domain/bookings';

type Trigger = {kind:string;id:string};
const providerId = (value: unknown, prefix: string): string => {
  insist(typeof value === 'string' && value.length <= 100 && /^[A-Za-z0-9_-]+$/.test(value),'billing_provider_identity_invalid',502); return value;
};
function reviewed(state: State,c: Connection) {
  const review = list(state,'billingConnectionReview').filter(r=>r.connectionId === c.connection_id && r.approvedAt && r.approvedBy).sort((a,b)=>a.approvedAt.localeCompare(b.approvedAt)).at(-1);
  insist(review?.ready === true && review.accountId === c.account_id,'billing_connection_review_required',409);
}
function fence(tx: Transaction,c: Connection) {
  tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_payment_connections WHERE id='billing' AND connection_id=? AND origin=? AND account_id=? AND key_digest=?) THEN 1 ELSE 0 END",c.connection_id,c.origin,c.account_id,c.key_digest));
}
function retained(state: State,invoiceId: string) { return record(state,invoiceId,'stripeInvoice'); }
function packDebt(state: State,pack: RecordData) {
  const charges = list(state,'charge').filter(r=>r.packId === pack.id);
  insist(charges.length > 0 && charges.every(r=>r.personId === pack.personId && !r.forPersonId && Number.isSafeInteger(r.amountCents) && r.amountCents >= 0 && (!r.reason || r.reason === 'initiation_fee')),'billing_pack_charge_mismatch',409);
  insist(!list(state,'household').some(h=>h.payerId === pack.personId || h.participantIds.includes(pack.personId) && h.payerId),'billing_household_payer_unsupported',409);
  const amountCents = charges.reduce((n,c)=>n+c.amountCents,0);
  insist(Number.isSafeInteger(amountCents) && amountCents > 0 && amountCents <= 100_000_000 && amountCents === pack.amountCents+(pack.initiationFeeCents ?? 0),'billing_pack_amount_mismatch',409);
  return {amountCents,chargeIds:charges.map(c=>c.id).sort()};
}
function noReceipts(state: State,invoice: RecordData) {
  const allocations = list(state,'contractPrepayment');
  insist(!allocations.some(a=>a.packId === invoice.packId || invoice.chargeIds.includes(a.chargeId)),'billing_pack_already_paid',409);
  insist(!list(state,'payment').some(p=>p.personId === invoice.personId && p.amountCents > 0 &&
    (p.packId === invoice.packId || invoice.chargeIds.includes(p.chargeId) || !p.chargeId && allocations.filter(a=>a.paymentId === p.id).reduce((n,a)=>n+a.amountCents,0) < p.amountCents)),'billing_receipts_need_reconciliation',409);
}
function source(state: State,invoice: RecordData) {
  person(state,invoice.personId,false); // Erasure must never recreate member-linked records.
  const pack = record(state,invoice.packId,'pack');
  insist(pack.personId === invoice.personId,'billing_pack_source_changed',409);
  return pack;
}
function unchangedDebt(state: State,invoice: RecordData) {
  const debt = packDebt(state,source(state,invoice));
  insist(debt.amountCents === invoice.amountCents && JSON.stringify(debt.chargeIds) === JSON.stringify(invoice.chargeIds),'billing_pack_source_changed',409);
}
function native(state: State,invoice: RecordData) {
  const pack=source(state,invoice), member=person(state,invoice.personId,false);
  return {balanceCents:balance(state,invoice.personId),access:{memberActive:member.active,expiresAt:pack.expiresAt,remaining:pack.remaining,creditRevision:pack.creditRevision ?? 0,entitlement:pack.entitlement ?? null}};
}
async function exception(tx: Transaction,invoice: RecordData,code: string,trigger: Trigger) {
  const exceptionId='billing-exception:'+await digest({invoiceId:invoice.id,code}),previous=tx.state.records.get(exceptionId)?.data;
  tx.put('billingException',{...previous,id:exceptionId,invoiceId:invoice.id,personId:invoice.personId,packId:invoice.packId,accountId:invoice.accountId,code,status:'open',firstSeenAt:previous?.firstSeenAt ?? now(),lastSeenAt:now(),trigger,resolvedAt:null});
}
function session(body: Json,invoice: RecordData) {
  providerId(body.id,'cs');
  insist(body.object === 'checkout.session' && body.livemode === false && body.mode === 'payment' && body.currency === 'usd' && body.amount_total === invoice.amountCents,'billing_checkout_amount_or_mode_mismatch',502);
  insist(body.metadata?.strapInvoiceId === invoice.id && body.client_reference_id === invoice.id && (!invoice.providerSessionId || body.id === invoice.providerSessionId),'billing_checkout_source_mismatch',502);
  insist(Array.isArray(body.payment_method_types) && body.payment_method_types.length === 1 && body.payment_method_types[0] === 'card','billing_checkout_card_required',502);
  insist(['open','complete','expired'].includes(body.status) && ['paid','unpaid','no_payment_required'].includes(body.payment_status),'billing_checkout_status_invalid',502);
  return body.id as string;
}
function settlement(body: Json,invoice: RecordData) {
  const pi=body.payment_intent,charge=pi?.latest_charge,bill=body.invoice;
  insist(body.status === 'complete' && body.payment_status === 'paid','billing_checkout_payment_incomplete',409);
  insist(pi?.object === 'payment_intent' && pi.livemode === false && pi.status === 'succeeded' && pi.currency === 'usd' && pi.amount === invoice.amountCents && pi.amount_received === invoice.amountCents && pi.metadata?.strapInvoiceId === invoice.id,'billing_payment_intent_mismatch',502);
  providerId(pi.id,'pi'); providerId(charge?.id,'ch'); providerId(bill?.id,'in');
  insist(charge.object === 'charge' && charge.livemode === false && charge.status === 'succeeded' && charge.paid === true && charge.captured === true && charge.currency === 'usd' && charge.amount === invoice.amountCents && charge.amount_captured === invoice.amountCents && charge.payment_intent === pi.id && charge.payment_method_details?.type === 'card','billing_charge_mismatch',502);
  insist(charge.refunded === false && charge.amount_refunded === 0 && charge.disputed === false && !charge.dispute,'billing_refund_or_dispute_requires_review',409);
  insist(bill.object === 'invoice' && bill.livemode === false && bill.currency === 'usd' && bill.status === 'paid' && bill.amount_due === invoice.amountCents && bill.amount_paid === invoice.amountCents && bill.amount_remaining === 0 && bill.metadata?.strapInvoiceId === invoice.id,'billing_provider_invoice_mismatch',502);
  return {paymentIntentId:pi.id as string,providerInvoiceId:bill.id as string,providerChargeId:charge.id as string};
}
function projection(body: Json|null) {
  if(!body)return null;
  const bounded=(value: unknown)=>typeof value === 'string' && value.length <= 100 ? value : null;
  return {sessionId:bounded(body.id),status:bounded(body.status),paymentStatus:bounded(body.payment_status),currency:bounded(body.currency),amountCents:Number.isSafeInteger(body.amount_total)?body.amount_total:null,livemode:body.livemode === false ? false : null,
    paymentIntentId:bounded(body.payment_intent?.id),paymentIntentStatus:bounded(body.payment_intent?.status),chargeId:bounded(body.payment_intent?.latest_charge?.id),refunded:body.payment_intent?.latest_charge?.refunded === true,disputed:body.payment_intent?.latest_charge?.disputed === true,providerInvoiceId:bounded(body.invoice?.id)};
}

/** Read an existing owner-started checkout. This never starts or settles a payment. */
export async function selectedCheckout(env: BillingBindings,who: Actor,token: string,invoiceId: string) {
  const validate=async()=>{
    const loaded=await load(env.DB,who);
    insist(loaded.who.role==='member' && loaded.who.personId,'member_required',403);
    widgetAdult(loaded.state,loaded.who.personId!);
    const selected=await widgetSelection(env.DB,loaded.state,token),invoice=retained(loaded.state,invoiceId);
    insist(invoice.personId===loaded.who.personId,'billing_invoice_not_found',404);
    const c=await connection(env);reviewed(loaded.state,c);
    insist(invoice.accountId===c.account_id && invoice.connectionId===c.connection_id && invoice.origin===env.AUTH_ORIGIN,'billing_reconnection_required',409);
    insist(invoice.status==='open' && invoice.providerSessionId,'billing_checkout_not_open',409);
    unchangedDebt(loaded.state,invoice);noReceipts(loaded.state,invoice);
    insist(eligiblePacks(loaded.state,loaded.who.personId!,selected.entry).some(p=>p.id===invoice.packId),'billing_pack_not_eligible',409);
    return invoice;
  };
  const invoice=await validate();
  const response=await stripe(env,'/checkout/sessions/'+encodeURIComponent(invoice.providerSessionId));
  session(response.body,invoice);
  insist(response.body.status==='open' && response.body.payment_status==='unpaid' && (!response.body.expires_at || response.body.expires_at*1000>Date.now()),'billing_checkout_not_open',409);
  const fresh=await validate();
  insist(fresh.providerSessionId===invoice.providerSessionId && fresh.amountCents===invoice.amountCents,'billing_checkout_changed',409);
  return {url:hostedURL(response.body.url),amountCents:invoice.amountCents};
}

/** The native identity is once per connected account and approved pack, including lost responses. */
export async function startCheckout(env: BillingBindings,who: Actor,input: Record<string,unknown>) {
  const loaded=await load(env.DB,who),tx=new Transaction(env.DB,loaded.state,loaded.who);humanOwner(tx.who);
  const requestId=text(input.requestId,'requestId',100);insist(input.confirm === true,'billing_checkout_confirmation_required');
  const c=await connection(env); reviewed(tx.state,c); await keyDigest(env);
  const pack=record(tx.state,input.packId,'pack'),member=person(tx.state,pack.personId);
  insist(member.role === 'member' && pack.expiresAt > now(),'billing_pack_not_eligible',409);
  // An owner-approved pack draft or the member's own confirmed intro sale; never an unreviewed pack.
  const sale=pack.introSaleId ? record(tx.state,pack.introSaleId,'introSale') : null;
  if(sale)insist(sale.packId === pack.id && sale.personId === member.id,'billing_approved_pack_required',409);
  else { const draft=record(tx.state,pack.draftId,'draft');insist(draft.type === 'pack' && draft.status === 'approved' && draft.personId === member.id,'billing_approved_pack_required',409); }
  const invoiceId='stripe-invoice:'+await digest({accountId:c.account_id,packId:pack.id});
  const prior=tx.state.records.get(invoiceId);
  if(prior) { insist(prior.kind === 'stripeInvoice' && prior.data.personId === member.id,'billing_invoice_source_mismatch',409);return prior.data; }
  const debt=packDebt(tx.state,pack),invoice={id:invoiceId,personId:member.id,packId:pack.id,...debt,accountId:c.account_id,connectionId:c.connection_id,origin:c.origin,providerSessionId:null,status:'creating',providerInvoiceId:null,paymentIntentId:null,paymentId:null,requestId,createdBy:tx.who.id,createdAt:now()};
  noReceipts(tx.state,invoice); fence(tx,c);tx.future(pack.expiresAt);tx.put('stripeInvoice',invoice);await tx.commit();
  try {
    const form=new URLSearchParams({mode:'payment','payment_method_types[0]':'card',client_reference_id:invoice.id,success_url:env.AUTH_ORIGIN+'/app/packs?billing=returned',cancel_url:env.AUTH_ORIGIN+'/app/packs?billing=canceled',
      'line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(invoice.amountCents),'line_items[0][price_data][product_data][name]':'Approved studio pack','line_items[0][quantity]':'1','invoice_creation[enabled]':'true',
      'metadata[strapInvoiceId]':invoice.id,'payment_intent_data[metadata][strapInvoiceId]':invoice.id,'invoice_creation[invoice_data][metadata][strapInvoiceId]':invoice.id});
    const result=await stripe(env,'/checkout/sessions',form,invoice.id);session(result.body,invoice);const launchURL=hostedURL(result.body.url);
    const fresh=await load(env.DB,who),finish=new Transaction(env.DB,fresh.state,fresh.who);humanOwner(finish.who);
    const current=await connection(env);insist(current.connection_id === c.connection_id,'billing_connection_changed',409);reviewed(finish.state,current);fence(finish,current);
    const saved=retained(finish.state,invoice.id),currentPack=source(finish.state,saved);person(finish.state,saved.personId);insist(currentPack.expiresAt > now(),'billing_pack_not_eligible',409);finish.future(currentPack.expiresAt);unchangedDebt(finish.state,saved);noReceipts(finish.state,saved);
    insist(saved.status === 'creating','billing_invoice_changed',409);
    const completed={...saved,status:result.body.status === 'expired'?'expired':'open',providerSessionId:result.body.id,updatedAt:now()};finish.put('stripeInvoice',completed);await finish.commit();return {...completed,launchURL};
  } catch(error) {
    const fresh=await load(env.DB,who),finish=new Transaction(env.DB,fresh.state,fresh.who);humanOwner(finish.who);
    const current=await connection(env);insist(current.account_id === c.account_id,'billing_connection_changed',409);reviewed(finish.state,current);fence(finish,current);
    const saved=retained(finish.state,invoice.id);source(finish.state,saved);
    if(saved.status === 'creating')finish.put('stripeInvoice',{...saved,status:'uncertain',updatedAt:now()});
    await exception(finish,saved,error instanceof DomainError?error.code:'billing_checkout_outcome_unknown',{kind:'checkout.start',id:requestId});await finish.commit();return retained(finish.state,invoice.id);
  }
}

async function discover(env: BillingBindings,invoice: RecordData) {
  let cursor='',match: string|null=null;
  for(let page=0;page<20;page++) {
    const result=await stripe(env,'/checkout/sessions?limit=100'+(cursor?'&starting_after='+encodeURIComponent(cursor):'')),body=result.body;
    insist(body.object === 'list' && Array.isArray(body.data) && body.data.length <= 100 && typeof body.has_more === 'boolean','billing_checkout_discovery_invalid',502);
    for(const item of body.data)if(item.metadata?.strapInvoiceId === invoice.id) { insist(!match,'billing_checkout_discovery_ambiguous',409);match=providerId(item.id,'cs'); }
    if(!body.has_more) { insist(match,'billing_checkout_session_not_found',409);return match; }
    const next=providerId(body.data.at(-1)?.id,'cs');insist(next !== cursor,'billing_checkout_discovery_incomplete',409);cursor=next;
  }
  throw new DomainError('billing_checkout_discovery_incomplete',409);
}
async function reconcile(env: BillingBindings,invoiceId: string,trigger: Trigger,who?: Actor) {
  trigger={kind:text(trigger.kind,'triggerKind',100),id:text(trigger.id,'triggerId',100)};
  const read=()=>who?load(env.DB,who):loadSystem(env.DB);
  const initial=await read();if(who)humanOwner(initial.who);
  const invoice=retained(initial.state,invoiceId);source(initial.state,invoice);
  const c=await connection(env);reviewed(initial.state,c);insist(c.account_id === invoice.accountId,'billing_invoice_account_mismatch',409);
  let body: Json|null=null,errorCode: string|null=null,sessionId: string|null=invoice.providerSessionId,settled: ReturnType<typeof settlement>|null=null;
  try {
    sessionId=sessionId ?? await discover(env,invoice);
    body=(await stripe(env,'/checkout/sessions/'+encodeURIComponent(sessionId)+'?expand[]=payment_intent.latest_charge&expand[]=invoice')).body;
    session(body,invoice);
    if(body.payment_status === 'paid' || body.status === 'complete' || invoice.status === 'paid')settled=settlement(body,invoice);
  } catch(error) { errorCode=error instanceof DomainError?error.code:'billing_checkout_reconciliation_unavailable'; }
  // Always re-read the actor, member, connection and balances after the provider edge.
  const fresh=await read(),tx=new Transaction(env.DB,fresh.state,fresh.who);if(who)humanOwner(tx.who);
  const current=await connection(env);reviewed(tx.state,current);insist(current.connection_id === c.connection_id && current.account_id === invoice.accountId,'billing_connection_changed',409);fence(tx,current);
  const saved=retained(tx.state,invoiceId),before=native(tx.state,saved);let paymentRecorded=false;
  if(!errorCode && body) {
    try {
      insist(!saved.providerSessionId || saved.providerSessionId === sessionId,'billing_checkout_source_mismatch',409);
      if(settled) {
        const paymentId='stripe-payment:'+await digest({accountId:saved.accountId,paymentIntentId:settled.paymentIntentId}),existing=tx.state.records.get(paymentId);
        if(saved.status === 'paid') insist(saved.paymentId === paymentId && existing?.kind === 'payment' && existing.data.invoiceId === saved.id && existing.data.amountCents === saved.amountCents,'billing_native_payment_mismatch',409);
        else {
          unchangedDebt(tx.state,saved);noReceipts(tx.state,saved);insist(!existing,'billing_provider_payment_already_recorded',409);
          const payment={id:paymentId,personId:saved.personId,packId:saved.packId,invoiceId:saved.id,stripeInvoiceId:saved.id,chargeIds:saved.chargeIds,locationId:source(tx.state,saved).locationId ?? 'studio',accountId:saved.accountId,amountCents:saved.amountCents,reference:'stripe:'+saved.accountId+':'+settled.paymentIntentId,...settled,createdAt:now(),recordedBy:tx.who.id,collection:'stripe-test-checkout'};
          // Allocate this actual receipt to the original charges; credits and access are untouched.
          const allocations=await Promise.all(saved.chargeIds.map(async (chargeId:string)=>({id:'stripe-allocation:'+await digest({paymentId,chargeId}),personId:saved.personId,payerId:saved.personId,packId:saved.packId,paymentId,chargeId,amountCents:record(tx.state,chargeId,'charge').amountCents,reference:'stripe:'+await digest({paymentId,chargeId}),createdAt:now(),createdBy:tx.who.id})));
          tx.put('payment',payment);for(const allocation of allocations)if(allocation.amountCents > 0)tx.put('contractPrepayment',allocation);paymentRecorded=true;
        }
        tx.put('stripeInvoice',{...saved,...settled,providerSessionId:sessionId,paymentId,status:'paid',paidAt:saved.paidAt ?? now(),reconciledAt:now()});
      } else {
        insist(saved.status !== 'paid','billing_paid_checkout_cannot_regress',409);
        tx.put('stripeInvoice',{...saved,providerSessionId:sessionId,status:saved.status === 'expired' || body.status === 'expired'?'expired':'open',reconciledAt:now()});
      }
    } catch(error) { errorCode=error instanceof DomainError?error.code:'billing_native_reconciliation_failed'; }
  }
  const after=native(tx.state,saved),comparison={balanceBeforeCents:before.balanceCents,balanceAfterCents:after.balanceCents,expectedBalanceChangeCents:paymentRecorded?-saved.amountCents:0,balanceMatches:after.balanceCents === before.balanceCents-(paymentRecorded?saved.amountCents:0),accessBefore:before.access,accessAfter:after.access,accessMatches:JSON.stringify(before.access) === JSON.stringify(after.access)};
  if(!comparison.balanceMatches || !comparison.accessMatches)errorCode='billing_native_comparison_mismatch';
  if(errorCode)await exception(tx,saved,errorCode,trigger);
  else for(const prior of list(tx.state,'billingException').filter(e=>e.invoiceId === saved.id && e.status === 'open'))tx.put('billingException',{...prior,status:'resolved',resolvedAt:now(),resolvedByTrigger:trigger});
  tx.put('billingReconciliation',{id:'billing-reconciliation:'+await digest({invoiceId,trigger}),invoiceId,personId:saved.personId,packId:saved.packId,accountId:saved.accountId,connectionId:current.connection_id,trigger,at:now(),status:errorCode?'exception':'reconciled',errorCode,provider:projection(body),native:comparison,paymentRecorded});
  await tx.commit();return retained(tx.state,invoiceId);
}
export async function reconcileCheckout(env: BillingBindings,who: Actor,input: Record<string,unknown>) {
  const requestId=text(input.requestId,'requestId',100);return reconcile(env,text(input.id,'id',100),{kind:'owner.reconcile',id:requestId},who);
}
/** Webhooks supply only a durable trigger identity; canonical provider reads decide settlement. */
export async function syncCheckout(env: BillingBindings,invoiceId: string,trigger: Trigger) { return reconcile(env,text(invoiceId,'invoiceId',100),trigger); }
