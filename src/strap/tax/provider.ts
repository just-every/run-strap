import { loadSystem, Transaction } from '../domain/store';
import { DomainError, insist, now, type RecordData } from '../domain/types';
import { object, retainedResult, type Json, type TaxBindings } from './model';

/** One request only. No redirects, retries, alternate provider or assumed zero tax. */
export async function stripe(env: TaxBindings, path: string, form?: URLSearchParams, requestId?: string) {
  const response = await fetch('https://api.stripe.com/v1' + path, {
    method:form ? 'POST' : 'GET',redirect:'error',
    headers:{authorization:'Bearer ' + env.STRIPE_TAX_TEST_KEY,'Stripe-Version':'2025-06-30.basil',...(form ? {'content-type':'application/x-www-form-urlencoded','Idempotency-Key':requestId!} : {})},
    ...(form ? {body:form} : {}),signal:AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let body: Json;
  try { body = object(JSON.parse(raw),'provider_response'); }
  catch { body = {unparseableResponse:raw}; }
  return {httpStatus:response.status,requestId:response.headers.get('request-id'),body};
}
export type Receipt = Awaited<ReturnType<typeof stripe>>;
export class ProviderRefusal extends Error {
  constructor(public receipt: Receipt) { super('tax_provider_refused'); }
}
export function accepted(receipt: Receipt) {
  if (receipt.httpStatus < 200 || receipt.httpStatus >= 300) throw new ProviderRefusal(receipt);
  return receipt.body;
}
export function addressForm(form: URLSearchParams, prefix: string, a: Json) {
  for (const [field,value] of Object.entries(a)) form.set(prefix + '[' + (field === 'postalCode' ? 'postal_code' : field) + ']',String(value));
}
/** The exact human-approved request was committed before this internal completion.
 * System authority can retain that provider result; it cannot start a tax request. */
export async function complete(env: TaxBindings, reservation: RecordData, execute: () => Promise<Receipt>, apply: (tx: Transaction, body: Json) => RecordData) {
  let receipt: Receipt | null = null;
  let errorCode: string | null = null;
  let status = 'uncertain';
  try { receipt = await execute(); accepted(receipt); }
  catch (error) {
    if (error instanceof ProviderRefusal) {
      receipt = error.receipt;
      // 409, rate limits and server errors may still conceal a provider write.
      if ([400,401,402,403,404,422].includes(receipt.httpStatus)) status = 'failed';
      errorCode = 'tax_provider_refused';
    } else errorCode = error instanceof DomainError ? error.code : 'tax_provider_outcome_unknown';
  }
  if (reservation.type === 'config' && errorCode) status = 'failed';
  const current = await loadSystem(env.DB), tx = new Transaction(env.DB,current.state,current.who);
  const local = await env.DB.prepare("SELECT connection_hash FROM st_tax_connections WHERE id='tax'").first<{connection_hash:string}>();
  const owner = await env.DB.prepare("SELECT role,status FROM oa_operators WHERE id=?").bind(reservation.actorId).first<{role:string;status:string}>();
  let result: RecordData | null = null;
  if (receipt && !errorCode) {
    try {
      const pending = tx.state.records.get(reservation.id);
      insist(pending?.kind === 'taxOperation' && pending.data.status === 'pending' && pending.data.inputFingerprint === reservation.inputFingerprint,'tax_reservation_changed',409);
      insist(owner?.role === 'owner' && owner.status === 'active','tax_owner_authority_changed',409);
      insist(reservation.type === 'config' || local?.connection_hash === reservation.connectionHash,'tax_connection_review_required',409);
      tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active') THEN 1 ELSE 0 END",reservation.actorId));
      if (reservation.type !== 'config') tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM st_tax_connections WHERE id='tax' AND connection_hash=?) THEN 1 ELSE 0 END",reservation.connectionHash));
      result = apply(tx,receipt.body); status = 'succeeded';
    }
    catch (error) {
      // A provider write with an invalid or stale response stays unresolved. Never
      // commit partially constructed local ledger writes from a failed validator.
      tx.sql = [];
      errorCode = error instanceof DomainError ? error.code : 'tax_provider_evidence_invalid';
    }
  }
  const saved = {...reservation,status,errorCode,providerResponse:receipt,finishedAt:now(),resultId:result?.id ?? null};
  tx.put('taxOperation',saved);
  await tx.commit();
  return retainedResult(tx.state,saved);
}
