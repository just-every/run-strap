import { catalogPackInput, currentProductVersion, personalCatalogMember } from './product-catalog';
import { halfUp } from './plan-changes';
import { parseGuestTerms } from './guest-allowances';
import { humanOwner, preparer, id, instant, integer, insist, list, now, person, record, text, type State } from './types';
import type { Transaction } from './store';
import { approveDraft } from './drafts';
import { promoteAll } from './bookings';
import { settleUnpaid } from './desk';
import { appendPackEvent, packEvents } from './pack-credits';
import { countsCredits, parsePlan } from './entitlements';
import { packPlaces, placeId } from './locations';
import { debtorOf } from './households';

export function balance(state: State, personId: string) {
  return list(state,'charge').filter(r => r.personId === personId).reduce((sum,r) => sum+r.amountCents,0)
    - list(state,'payment').filter(r => r.personId === personId).reduce((sum,r) => sum+r.amountCents,0);
}
export function preparePack(tx: Transaction, input: Record<string,unknown>) {
  preparer(tx.who);
  const catalog = input.catalogVersionId === undefined ? null : catalogPackInput(tx,input);
  if (catalog) input = catalog.terms;
  const member = person(tx.state,input.personId), expiresAt = instant(input.expiresAt,'expiresAt');
  if (catalog) personalCatalogMember(tx.state,member);
  insist(expiresAt > now(),'expiry_must_be_future');
  tx.future(expiresAt);
  const eligibleServices = packServices(input.eligibleServices), priorityBooking = input.priorityBooking ?? false;
  insist(typeof priorityBooking === 'boolean','invalid_priorityBooking');
  // PLAN-002: a visits or unlimited plan holds visits, never a credit count.
  const entitlement = parsePlan(input), credits = !entitlement || entitlement.kind === 'credits' ? integer(input.credits,'credits',1,10_000) : 0;
  if (entitlement && entitlement.kind !== 'credits') insist(input.credits === undefined || input.credits === null || input.credits === '','plan_has_no_credit_count');
  const guestTerms = parseGuestTerms(input.guestTerms);
  const initiationFeeCents = integer(input.initiationFeeCents === undefined ? 0 : input.initiationFeeCents,'initiationFeeCents',0,100_000_000);
  const fullAmountCents = integer(input.amountCents,'amountCents',0,100_000_000);
  let proration = null;
  if (input.cycleStartAt !== undefined || input.joinAt !== undefined) {
    const cycleStartAt = instant(input.cycleStartAt,'cycleStartAt'), joinAt = instant(input.joinAt,'joinAt');
    insist([cycleStartAt,joinAt,expiresAt].every(at=>Date.parse(at)%1000===0),'proration_requires_whole_seconds');
    insist(cycleStartAt < joinAt && joinAt < expiresAt,'join_outside_cycle');
    const totalSeconds = (Date.parse(expiresAt)-Date.parse(cycleStartAt))/1000;
    const remainingSeconds = (Date.parse(expiresAt)-Date.parse(joinAt))/1000;
    proration = {cycleStartAt,joinAt,cycleEndAt:expiresAt,totalSeconds,remainingSeconds,fullAmountCents,
      amountCents:halfUp(BigInt(fullAmountCents)*BigInt(remainingSeconds),BigInt(totalSeconds)),rounding:'half-up',clock:'elapsed UTC seconds'};
  }
  const draft = {...(catalog ? {catalogVersion:catalog.version} : {}),proration,guestTerms,eligibleServices,priorityBooking,...packPlaces(tx.state,input),...(entitlement ? {entitlement} : {}),id:id(),type:'pack',status:'draft',personId:member.id,personVersion:member.version,credits,amountCents:proration?.amountCents ?? fullAmountCents,initiationFeeCents,expiresAt,createdAt:now(),createdBy:tx.who.id,createdByRole:tx.who.role};
  tx.put('draft',draft); return draft;
}
export function approvePack(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const draft = record(tx.state,input.id,'draft');
  insist(draft.type === 'pack','wrong_draft_type');
  const member = person(tx.state,draft.personId);
  insist(member.version === draft.personVersion,'person_changed',409);
  if (draft.catalogVersion) { currentProductVersion(tx.state,draft.catalogVersion.id); personalCatalogMember(tx.state,member); }
  insist(draft.expiresAt > now(),'expiry_must_be_future');
  tx.future(draft.expiresAt);
  approveDraft(tx,draft);
  const pack = {...(draft.catalogVersion ? {catalogVersion:structuredClone(draft.catalogVersion)} : {}),purchaseAmountCents:draft.amountCents,proration:draft.proration ?? null,...(draft.proration ? {termStartAt:draft.proration.joinAt} : {}),guestTerms:draft.guestTerms ?? null,id:id(),personId:member.id,locationId:draft.locationId ?? 'studio',eligibleLocations:draft.eligibleLocations ?? ['studio'],eligibleServices:draft.eligibleServices ?? [],priorityBooking:draft.priorityBooking === true,...(draft.entitlement ? {entitlement:draft.entitlement} : {}),creditLedgerVersion:1,creditRevision:0,credits:draft.credits,remaining:0,amountCents:draft.amountCents,initiationFeeCents:draft.initiationFeeCents ?? 0,expiresAt:draft.expiresAt,draftId:draft.id,createdAt:now()};
  tx.put('pack',pack);
  appendPackEvent(tx,pack,{type:'grant',credits:draft.credits});
  const debtor = debtorOf(tx.state,member.id), forMember = debtor === member.id ? {} : {forPersonId:member.id};
  tx.put('charge',{id:id(),personId:debtor,...forMember,packId:pack.id,...(draft.catalogVersion ? {catalogVersionId:draft.catalogVersion.id} : {}),amountCents:draft.amountCents,createdAt:now()});
  if (pack.initiationFeeCents > 0) tx.put('charge',{id:id(),personId:debtor,...forMember,packId:pack.id,reason:'initiation_fee',amountCents:pack.initiationFeeCents,createdAt:now()});
  settleUnpaid(tx,record(tx.state,pack.id,'pack'));
  promoteAll(tx);
  return {id:pack.id,draftId:draft.id,status:'approved'};
}
function packServices(value: unknown): string[] {
  if (value === undefined) return [];
  insist(Array.isArray(value) && value.length <= 100,'invalid_eligibleServices');
  const labels = value.map(item => text(item,'eligibleServices',160).replace(/\s+/g,' '));
  const unique = new Map<string,string>();
  for (const label of labels) if (!unique.has(label.toLowerCase())) unique.set(label.toLowerCase(),label);
  return [...unique.values()];
}
/** Adjust available credits and/or expiration without changing purchase terms. */
export function adjustPack(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const pack = record(tx.state,input.id,'pack');
  const requestId = text(input.requestId,'requestId',100), reason = text(input.reason,'reason',2_000);
  const creditsDelta = integer(input.creditsDelta,'creditsDelta',-10_000,10_000);
  insist(creditsDelta === 0 || countsCredits(pack),'plan_has_no_credit_balance',409);
  const expiresAt = input.expiresAt === undefined ? undefined : instant(input.expiresAt,'expiresAt');
  const requestBasis = JSON.stringify({creditsDelta,reason,expiresAt:expiresAt ?? null});
  const prior = packEvents(tx.state,pack).find(event => event.requestId === requestId);
  if (prior) {
    insist(prior.actorId === tx.who.id && prior.requestBasis === requestBasis,'adjustment_request_changed',409);
    return prior;
  }
  const revision = integer(input.revision,'revision',0,1_000_000);
  insist(revision === (pack.creditRevision ?? 0),'pack_changed',409);
  insist(creditsDelta !== 0 || (expiresAt !== undefined && expiresAt !== pack.expiresAt),'adjustment_requires_change');
  const event = appendPackEvent(tx,pack,{type:'adjust',credits:creditsDelta,reason,requestId,requestBasis,...(expiresAt ? {expiresAt} : {})});
  promoteAll(tx);
  return event;
}
export function recordPayment(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const member = person(tx.state,input.personId,false), reference = text(input.reference,'reference',160);
  insist(!list(tx.state,'payment').some(p => p.reference === reference),'payment_reference_used',409);
  const payment = {id:id(),personId:member.id,locationId:placeId(tx.state,input.locationId),amountCents:integer(input.amountCents,'amountCents',1,100_000_000),reference,createdAt:now(),recordedBy:tx.who.id};
  tx.put('payment',payment); return payment;
}
// Adapted Nectar src/nectar/collections.ts reminderBasis/basisKey and
// approveReminder, 7f38865a4d41e13e24c1cb16a07ae489c9184cea. The exact facts
// (not only the sum) must still hold; approval exports text and sends no mail.
function reminderBasis(state: State, personId: string) {
  const member = person(state,personId,false);
  return JSON.stringify({personVersion:member.version,email:member.email,name:member.name,
    charges:list(state,'charge').filter(r => r.personId === personId).map(r => [r.id,r.amountCents]),
    payments:list(state,'payment').filter(r => r.personId === personId).map(r => [r.id,r.amountCents,r.reference])});
}
export function prepareReminder(tx: Transaction, input: Record<string,unknown>) {
  preparer(tx.who);
  const member = person(tx.state,input.personId,false), balanceCents = balance(tx.state,member.id);
  insist(balanceCents > 0,'nothing_owed',409);
  const amount = (balanceCents/100).toFixed(2);
  const draft = {id:id(),type:'reminder',status:'draft',personId:member.id,balanceCents,basis:reminderBasis(tx.state,member.id),recipient:member.email,subject:`Studio balance reminder: $${amount}`,body:`Hello ${member.name},\n\nOur records show a studio balance of $${amount}. If you have already paid, please reply with your payment reference so we can match it.\n\nThank you.`,createdAt:now(),createdBy:tx.who.id,createdByRole:tx.who.role};
  tx.put('draft',draft); return draft;
}
export function approveReminder(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const draft = record(tx.state,input.id,'draft');
  insist(draft.type === 'reminder','wrong_draft_type');
  insist(draft.basis === reminderBasis(tx.state,draft.personId),'balances_changed',409);
  approveDraft(tx,draft);
  return {id:draft.id,status:'approved',text:`To: ${draft.recipient}\nSubject: ${draft.subject}\n\n${draft.body}\n`};
}
