import { insist, list, person, record, type Actor, type State } from '../domain/types';
import { sha256Hex } from '../security/crypto';

export interface BillingBindings { DB: D1Database; AUTH_ORIGIN: string; STRIPE_BILLING_TEST_KEY?: string; RER_DEMO?: string }
export type Json = Record<string, any>;
export type Connection = {connection_id:string;origin:string;account_id:string;key_digest:string};
export const canonical = (value: any): string => JSON.stringify(sort(value));
function sort(value: any): any { return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])])) : value; }
export const digest = (value: any) => sha256Hex(canonical(value));
export async function keyDigest(env: BillingBindings) {
  insist(env.STRIPE_BILLING_TEST_KEY && env.RER_DEMO !== '1','stripe_billing_test_not_configured',409);
  insist(!/^(?:sk|rk)_live_/.test(env.STRIPE_BILLING_TEST_KEY),'stripe_billing_live_key_refused',409);
  return sha256Hex('strap-billing-test\n'+env.AUTH_ORIGIN+'\n'+env.STRIPE_BILLING_TEST_KEY);
}
export async function connection(env: BillingBindings): Promise<Connection> {
  const local = await env.DB.prepare("SELECT connection_id,origin,account_id,key_digest FROM st_payment_connections WHERE id='billing'").first<Connection>();
  insist(local && local.origin === env.AUTH_ORIGIN && local.key_digest === await keyDigest(env),'billing_reconnection_required',409);
  return local;
}
export function ownMember(state: State,who: Actor,personId: unknown) {
  insist(who.role === 'member' && who.personId === personId,'member_authorization_required',403);
  return person(state,personId);
}
export function eligibleAdult(state: State,personId: string) {
  // Household and cancellation authority never establish adult financial capacity.
  insist(!list(state,'household').some(h=>h.guardianIds.length && h.participantIds.includes(personId)),'adult_financial_authority_required',409);
  insist(!list(state,'contractAuthority').some(g=>g.personId === personId && g.kind === 'minor-guardian' && !g.revokedAt && (!g.adultAt || g.adultAt > new Date().toISOString())),'adult_financial_authority_required',409);
}
export function currentAgreement(state: State,id: unknown) {
  const agreement = record(state,id,'billingAgreement'), terms = record(state,agreement.termsId,'recurringTerms');
  insist(terms.status === 'active' && terms.acceptedAt && terms.key === agreement.termsKey && terms.amountCents === agreement.amountCents && terms.intervalMonths === agreement.intervalMonths && (terms.currentPriceDisclosureId ?? null) === agreement.priceDisclosureId,'billing_agreement_terms_changed',409);
  eligibleAdult(state,agreement.personId);
  return agreement;
}
export function mandateFor(state: State,agreementId: string) { return list(state,'paymentMandate').find(m=>m.agreementId === agreementId) ?? null; }
export function requireMandate(state: State,agreementId: unknown,who: Actor) {
  const a = currentAgreement(state,agreementId); ownMember(state,who,a.personId);
  const mandate = mandateFor(state,a.id);
  insist(a.signature && mandate?.status === 'accepted','payment_mandate_required',409);
  return {agreement:a,mandate};
}
