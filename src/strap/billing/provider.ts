import { DomainError, insist } from '../domain/types';
import type { BillingBindings, Json } from './model';

export async function stripe(env: BillingBindings,path: string,form?: URLSearchParams,operationId?: string) {
  const response = await fetch('https://api.stripe.com/v1'+path,{method:form?'POST':'GET',redirect:'manual',headers:{authorization:'Bearer '+env.STRIPE_BILLING_TEST_KEY,'Stripe-Version':'2025-06-30.basil',...(form?{'content-type':'application/x-www-form-urlencoded','Idempotency-Key':operationId!}:{})},...(form?{body:form}:{}),signal:AbortSignal.timeout(20000)});
  let body: Json;
  try { body = await response.json() as Json; } catch { throw new DomainError('billing_provider_response_invalid',502); }
  if(response.status < 200 || response.status >= 300) throw new ProviderFailure(response.status,typeof body.error?.code === 'string' ? body.error.code : 'provider_refused',response.headers.get('request-id'));
  insist(body && typeof body === 'object' && !Array.isArray(body),'billing_provider_response_invalid',502);
  return {body,requestId:response.headers.get('request-id'),httpStatus:response.status};
}
export class ProviderFailure extends Error {
  constructor(public status: number,public providerCode: string,public requestId: string|null) { super('billing_provider_refused'); }
}
export function hostedURL(value: unknown) {
  insist(typeof value === 'string','billing_hosted_url_invalid',502);
  const url = new URL(value);
  insist(url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' && !url.username && !url.password,'billing_hosted_url_invalid',502);
  return value;
}
export function session(body: Json,agreementId: string,mandateId: string,operationId: string) {
  insist(body.object === 'checkout.session' && body.livemode === false && body.mode === 'setup' && typeof body.id === 'string','billing_provider_mode_mismatch',502);
  insist(body.client_reference_id === agreementId && body.metadata?.agreementId === agreementId && body.metadata?.mandateId === mandateId && body.metadata?.operationId === operationId,'billing_provider_source_mismatch',502);
  return {id:body.id,status:body.status,expiresAt:typeof body.expires_at === 'number' ? new Date(body.expires_at*1000).toISOString() : null};
}
export function savedMethod(body: Json,agreementId: string,mandateId: string,operationId: string) {
  const checked=session(body,agreementId,mandateId,operationId);
  insist(checked.status === 'complete','billing_hosted_setup_incomplete',409);
  const intent=body.setup_intent,method=intent?.payment_method;
  insist(intent && intent.object === 'setup_intent' && intent.livemode === false && intent.status === 'succeeded' && intent.usage === 'off_session' && typeof intent.id === 'string','billing_setup_authorization_incomplete',409);
  insist(intent.metadata?.agreementId === agreementId && intent.metadata?.mandateId === mandateId && intent.metadata?.operationId === operationId,'billing_provider_source_mismatch',502);
  insist(method && method.object === 'payment_method' && method.livemode === false && method.type === 'card' && typeof method.id === 'string','billing_saved_card_required',502);
  const card=method.card;
  insist(card && /^\d{4}$/.test(card.last4) && typeof card.brand === 'string' && Number.isInteger(card.exp_month) && Number.isInteger(card.exp_year),'billing_masked_method_invalid',502);
  // Explicit projection: never retain client secrets, billing addresses, fingerprints,
  // hosted URLs or arbitrary provider bodies in the studio's portable records.
  return {sessionId:checked.id,setupIntentId:intent.id,paymentMethodId:method.id,customerId:typeof intent.customer === 'string' ? intent.customer : null,type:'card',brand:card.brand,last4:card.last4,expiryMonth:card.exp_month,expiryYear:card.exp_year,livemode:false};
}
