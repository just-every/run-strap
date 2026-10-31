import type { Bindings } from '../auth.server';
import { load, Transaction } from './domain/store';
import { DomainError, humanOwner, insist, list, now, person, record, text, type Actor, type RecordData, type State } from './domain/types';
import { cleared } from './security/gate';
import { connection, digest, fenceConnection, reviewedConnection, type BillingBindings } from './billing/model';
import { balanceTransaction, payoutObservation, providerIdentity, stripe, stripeList } from './billing/provider';
import { membershipReport, payoutMembership, sumCents as sum } from './payout-membership';

const refreshKind='payoutRefresh',cardKind='cardBalanceObservation',payoutKind='payoutObservation';
const failure=(error: unknown)=>error instanceof DomainError ? error.code : 'payout_provider_read_unavailable';
const sources=(state: State,accountId: string)=>list(state,'stripeInvoice').filter(i=>i.accountId===accountId && i.status==='paid' && !i.erased && state.people.some(p=>p.id===i.personId && !p.erasedAt));
async function authority(env: BillingBindings,who: Actor) {
  const loaded=await load(env.DB,who);humanOwner(loaded.who);
  insist(await cleared(env as Bindings,loaded.who),'mfa_required',403);
  insist(who.sessionId && await env.DB.prepare("SELECT id FROM oa_sessions WHERE id=? AND operator_id=? AND operator_version=? AND revoked_at IS NULL AND expires_at>?").bind(who.sessionId,who.id,loaded.state.operator.version,Date.now()).first(),'owner_session_required',401);
  return loaded;
}
function fenceAuthority(tx: Transaction) {
  tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_sessions s JOIN st_mfa_sessions m ON m.session_id=s.id AND m.operator_id=s.operator_id WHERE s.id=? AND s.operator_id=? AND s.operator_version=? AND s.revoked_at IS NULL AND s.expires_at>unixepoch('now')*1000) THEN 1 ELSE 0 END",tx.who.sessionId,tx.who.id,tx.state.operator.version));
}
async function merchant(env: BillingBindings,accountId: string) {
  const {body}=await stripe(env,'/account');
  insist(body.object==='account' && body.id===accountId,'payout_merchant_mismatch',409);
}

/** Explicit owner review reads Stripe only. A durable reservation prevents replayed refreshes. */
export async function refreshPayouts(env: BillingBindings,who: Actor,input: Record<string,unknown>) {
  const initial=await authority(env,who),c=await connection(env);reviewedConnection(initial.state,c);
  insist(input.confirm===true,'payout_refresh_confirmation_required');
  const requestId=text(input.requestId,'requestId',100),id='payout-refresh:'+await digest({accountId:c.account_id,requestId});
  const prior=initial.state.records.get(id);
  if(prior) {insist(prior.kind===refreshKind,'payout_refresh_identity_conflict',409);return prior.data;}
  // Refuse foreign credentials before reserving or retaining any observations.
  await merchant(env,c.account_id);
  const checked=await authority(env,who),current=await connection(env);
  insist(current.connection_id===c.connection_id && current.account_id===c.account_id,'billing_connection_changed',409);
  reviewedConnection(checked.state,current);
  const tx=new Transaction(env.DB,checked.state,checked.who);
  const invoices=sources(tx.state,c.account_id),startedAt=now();
  const reservation={id,accountId:c.account_id,connectionId:c.connection_id,requestId,startedAt,actorId:who.id,status:'refreshing',completedAt:null};
  fenceConnection(tx,c);fenceAuthority(tx);tx.put(refreshKind,reservation);await tx.commit();
  const cards: RecordData[]=[],payouts: RecordData[]=[];
  let payoutError: string|null=null;
  for(const invoice of invoices) {
    const observedAt=now(),base={id:'card-observation:'+await digest({refreshId:id,invoiceId:invoice.id}),refreshId:id,accountId:c.account_id,invoiceId:invoice.id,paymentId:invoice.paymentId,personId:invoice.personId,packId:invoice.packId,providerChargeId:invoice.providerChargeId,sourceAmountCents:invoice.amountCents,sourceCurrency:'usd',observedAt};
    try {
      const payment=record(checked.state,invoice.paymentId,'payment');
      insist(payment.stripeInvoiceId===invoice.id && payment.accountId===c.account_id && payment.providerChargeId===invoice.providerChargeId && payment.amountCents===invoice.amountCents,'payout_native_source_mismatch',409);
      const charge=(await stripe(env,'/charges/'+encodeURIComponent(providerIdentity(invoice.providerChargeId))+'?expand[]=balance_transaction')).body;
      insist(charge.object==='charge' && charge.id===invoice.providerChargeId && charge.livemode===false && charge.currency==='usd' && charge.paid===true && charge.captured===true && charge.amount===invoice.amountCents && charge.amount_captured===invoice.amountCents && charge.payment_intent===invoice.paymentIntentId && charge.payment_method_details?.type==='card','payout_charge_source_mismatch',502);
      insist(charge.refunded===false && charge.amount_refunded===0 && charge.disputed===false && !charge.dispute,'payout_refund_or_dispute_unresolved',409);
      insist(charge.balance_transaction && typeof charge.balance_transaction==='object','payout_fee_unavailable',409);
      const value=balanceTransaction(charge.balance_transaction);
      insist(value.sourceId===charge.id && value.type==='charge' && (value.currency!=='usd' || value.grossCents===invoice.amountCents),'payout_balance_source_mismatch',502);
      cards.push({...base,...value,status:'observed',errorCode:null});
    } catch(error) {cards.push({...base,status:'unresolved',errorCode:failure(error),providerTransactionId:null,grossCents:null,feeCents:null,netCents:null});}
  }
  try {
    const observations=await stripeList(env,'/payouts');
    for(const body of observations) {
      const value=payoutObservation(body),observedAt=now();
      const membership=await payoutMembership(env,value);
      payouts.push({id:'payout-observation:'+await digest({refreshId:id,payoutId:value.providerPayoutId}),refreshId:id,accountId:c.account_id,observedAt,...value,...membership,depositStatus:'unmatched',bankDepositConfirmed:false});
    }
  } catch(error) {payoutError=failure(error);}
  // Never let a disconnected, changed or erased source acquire new observations.
  const fresh=await authority(env,who),finish=new Transaction(env.DB,fresh.state,fresh.who),latest=await connection(env);
  insist(latest.connection_id===c.connection_id && latest.account_id===c.account_id && latest.key_digest===c.key_digest,'billing_connection_changed',409);reviewedConnection(finish.state,latest);
  await merchant(env,c.account_id);fenceConnection(finish,c);fenceAuthority(finish);
  const retained=record(finish.state,id,refreshKind);
  if(retained.status!=='refreshing')return retained;
  for(const card of cards) {
    person(finish.state,card.personId,false);
    const invoice=record(finish.state,card.invoiceId,'stripeInvoice');
    insist(!invoice.erased && invoice.status==='paid' && invoice.paymentId===card.paymentId && invoice.providerChargeId===card.providerChargeId,'payout_native_source_changed',409);
    finish.put(cardKind,card);
  }
  for(const payout of payouts)finish.put(payoutKind,payout);
  const complete={...retained,completedAt:now(),status:cards.some(c=>c.status==='unresolved') || payoutError || payouts.some(p=>p.mappingError && p.automatic) ? 'incomplete' : 'observed',payoutError,cardCount:cards.length,payoutCount:payouts.length};
  finish.put(refreshKind,complete);await finish.commit();return complete;
}

function latestBy(rows: RecordData[],key: string) {
  const map=new Map<string,RecordData>();
  for(const row of rows)if(!map.has(row[key]) || map.get(row[key])!.observedAt<=row.observedAt)map.set(row[key],row);
  return [...map.values()].sort((a,b)=>String(a[key]).localeCompare(String(b[key])));
}
/** Pure retained projection. It never retries reads, collects, settles or matches a bank deposit. */
export async function payoutReport(env: BillingBindings,who: Actor) {
  const loaded=await authority(env,who),state=loaded.state,refreshes=list(state,refreshKind),latest=refreshes.at(-1) ?? null;
  let connected=false;
  try {const c=await connection(env);reviewedConnection(state,c);connected=true;} catch(error) {
    if(!(error instanceof DomainError) || !['billing_reconnection_required','stripe_billing_test_not_configured','billing_connection_review_required'].includes(error.code))throw error;
  }
  const observations=latestBy(list(state,cardKind).filter(r=>!r.erased && state.people.some(p=>p.id===r.personId && !p.erasedAt)),'invoiceId');
  const cards: RecordData[]=observations.map(row=>({...row,stale:row.refreshId!==latest?.id}));
  for(const invoice of list(state,'stripeInvoice').filter(i=>i.status==='paid' && !i.erased && state.people.some(p=>p.id===i.personId && !p.erasedAt)))if(!cards.some(c=>c.invoiceId===invoice.id))cards.push({id:invoice.id,invoiceId:invoice.id,paymentId:invoice.paymentId,accountId:invoice.accountId,providerChargeId:invoice.providerChargeId,status:'unresolved',errorCode:'payout_refresh_required',stale:true,observedAt:null,providerTransactionId:null,grossCents:null,feeCents:null,netCents:null});
  const current=cards.filter(r=>r.status==='observed' && !r.stale);
  const currencies=[...new Set(current.map(r=>r.currency))].sort(),currency=currencies.length===1?currencies[0]:null;
  const complete=!!currency && !!latest && latest.status!=='refreshing' && current.length===cards.length;
  const byCurrency=currencies.map(currency=>{const rows=current.filter(r=>r.currency===currency);return {currency,grossCents:sum(rows,'grossCents'),feeCents:sum(rows,'feeCents'),netCents:sum(rows,'netCents'),cardCount:rows.length};});
  const payouts: RecordData[]=latestBy(list(state,payoutKind),'providerPayoutId').map(row=>({...row,stale:row.refreshId!==latest?.id,...membershipReport(row,current,row.refreshId===latest?.id)}));
  return {mode:'test',connected,latest,refreshes,cards,payouts,totals:{currency,byCurrency,observedGrossCents:currency?sum(current,'grossCents'):null,observedFeeCents:currency?sum(current,'feeCents'):null,observedNetCents:currency?sum(current,'netCents'):null,grossCents:complete?sum(current,'grossCents'):null,feeCents:complete?sum(current,'feeCents'):null,netCents:complete?sum(current,'netCents'):null,unresolvedCount:cards.length-current.length},bankDepositConfirmation:'unavailable',refundAndDisputeReconciliation:'unavailable',scope:'Native coverage is limited to personal one-time TEST card receipts. Provider payout statements may include other transactions; they do not establish native refund reconciliation or bank receipt.'};
}
export function payoutCsv(report: Awaited<ReturnType<typeof payoutReport>>) {
  const fields=['kind','id','refreshId','accountId','invoiceId','paymentId','packId','sourceId','type','sourceAmountCents','sourceCurrency','providerChargeId','providerTransactionId','providerPayoutId','observedAt','providerCreatedAt','availableAt','arrivalAt','currency','grossCents','feeCents','netCents','amountCents','status','providerStatus','providerReconciliationStatus','depositStatus','errorCode','mappingError','stale','automatic','mappedNetCents','unmappedTransactionCount','providerDifferenceCents','nativeCoverageStatus','statementGrossCents','statementFeeCents','statementNetCents','statementDifferenceCents','bankDepositConfirmed','cardGrossTotalCents','cardFeeTotalCents','cardNetTotalCents','bankDepositConfirmation'];
  const cell=(v: unknown)=>'"'+String(v??'').replace(/^([=+@-])/,'\t$1').replaceAll('"','""')+'"';
  const rows=[{kind:'refresh',id:report.latest?.id??'',accountId:report.latest?.accountId??'',observedAt:report.latest?.completedAt??null,status:report.latest?.status??'not_refreshed',errorCode:report.latest?.payoutError??null,cardGrossTotalCents:report.totals.grossCents,cardFeeTotalCents:report.totals.feeCents,cardNetTotalCents:report.totals.netCents,bankDepositConfirmation:report.bankDepositConfirmation,currency:report.totals.currency},...report.cards.map(r=>({kind:'card',...r})),...report.payouts.flatMap(r=>[
    {kind:'payout',...r,statementGrossCents:r.statementTotals?.grossCents,statementFeeCents:r.statementTotals?.feeCents,statementNetCents:r.statementTotals?.netCents},
    ...(r.transactions??[]).map((t: ReturnType<typeof balanceTransaction>)=>({kind:'payout_transaction',...t,id:r.id+':'+t.providerTransactionId,refreshId:r.refreshId,accountId:r.accountId,providerPayoutId:r.providerPayoutId,observedAt:r.observedAt,stale:r.stale})),
  ])];
  return [fields,...rows.map(row=>fields.map(field=>(row as Record<string,unknown>)[field]))].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
