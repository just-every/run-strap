import { humanOwner, id, insist, instant, integer, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { appendPackEvent } from './pack-credits';
import { settleUnpaid } from './desk';
import { promoteAll } from './bookings';

// PLAN-005 for current capabilities: a member's finite pack is the plan.
// 'now' changes credits and price inside the current term, prorated by elapsed
// UTC seconds; 'renewal' starts the next term at the current expiry at full price.
// The owner acts for the contract-change right until STAFF-001.
const seconds = (at: string) => Math.floor(Date.parse(at) / 1000);
export const termStart = (pack: RecordData) => pack.termStartAt ?? pack.createdAt;
/** Half-up on the magnitude: exactly half a cent rounds away from zero, sign kept. */
export function halfUp(numerator: bigint, denominator: bigint) {
  const sign = numerator < 0n ? -1n : 1n, magnitude = numerator * sign;
  return Number(sign * ((2n * magnitude + denominator) / (2n * denominator)));
}
const basis = (state: State, pack: RecordData) => JSON.stringify({pack:pack.id,revision:pack.creditRevision ?? 0,remaining:pack.remaining,
  credits:pack.credits,amountCents:pack.amountCents,termStartAt:termStart(pack),expiresAt:pack.expiresAt,personVersion:person(state,pack.personId,false).version});
const pending = (state: State, packId: string) => list(state,'planChange').find(c => c.packId === packId && c.status === 'accepted');

function preview(state: State, pack: RecordData, input: Record<string,unknown>) {
  const mode = text(input.mode,'mode',20);
  insist(mode === 'now' || mode === 'renewal','invalid_mode');
  const credits = integer(input.credits,'credits',1,10_000), amountCents = integer(input.amountCents,'amountCents',0,100_000_000);
  const at = now();
  insist(pack.expiresAt > at,'pack_expired',409);
  if (mode === 'renewal') {
    const expiresAt = instant(input.expiresAt,'expiresAt');
    insist(expiresAt > pack.expiresAt,'expiry_must_follow_term');
    return {mode,effectiveAt:pack.expiresAt,credits,amountCents,expiresAt,chargeCents:amountCents,creditsDelta:null,remainingAfter:credits,
      expiringCredits:pack.remaining,exception:false,formula:{kind:'full-term',termStartAt:pack.expiresAt,termEndAt:expiresAt,newAmountCents:amountCents}};
  }
  const effectiveAt = instant(input.effectiveAt,'effectiveAt');
  insist(Date.parse(effectiveAt) % 1000 === 0,'effective_at_whole_seconds');
  insist(effectiveAt > at,'effective_at_must_be_future');
  insist(effectiveAt < pack.expiresAt && effectiveAt >= termStart(pack),'effective_at_outside_term');
  const totalSeconds = seconds(pack.expiresAt) - seconds(termStart(pack)), remainingSeconds = seconds(pack.expiresAt) - seconds(effectiveAt);
  const differenceCents = amountCents - pack.amountCents, creditsDelta = credits - pack.credits;
  insist(differenceCents !== 0 || creditsDelta !== 0,'change_requires_new_terms');
  const chargeCents = halfUp(BigInt(differenceCents) * BigInt(remainingSeconds), BigInt(totalSeconds));
  insist(pack.remaining + creditsDelta >= 0,'allocations_exceed_new_credits',409);
  return {mode,effectiveAt,credits,amountCents,expiresAt:pack.expiresAt,chargeCents,creditsDelta,remainingAfter:pack.remaining + creditsDelta,expiringCredits:0,
    exception:differenceCents < 0 || creditsDelta < 0,formula:{kind:'prorated',termStartAt:termStart(pack),termEndAt:pack.expiresAt,totalSeconds,remainingSeconds,differenceCents}};
}

export function requestPlanChange(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member','member_required',403);
  const pack = record(tx.state,input.packId,'pack'), requestId = text(input.requestId,'requestId',100), note = text(input.note,'note',500);
  insist(pack.personId === tx.who.personId,'pack_not_found',404);
  const prior = list(tx.state,'planChangeRequest').find(r => r.personId === tx.who.personId && r.requestId === requestId);
  if (prior) { insist(prior.packId === pack.id && prior.note === note,'plan_request_changed',409); return prior; }
  const request = {id:id(),personId:pack.personId,packId:pack.id,note,requestId,status:'requested',createdAt:now(),actorId:tx.who.id};
  tx.put('planChangeRequest',request); return request;
}

/** Staff door: the exact preview the member alone accepts. */
export function preparePlanChange(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who); text(input.requestId,'requestId',100);
  const pack = record(tx.state,input.packId,'pack'), member = person(tx.state,pack.personId);
  insist(!pending(tx.state,pack.id),'plan_change_pending',409);
  const terms = preview(tx.state,pack,input);
  const exceptionReason = input.exceptionReason === undefined || input.exceptionReason === '' ? null : text(input.exceptionReason,'exceptionReason',500);
  insist(!terms.exception || exceptionReason,'exception_reason_required');
  const request = input.planRequestId ? record(tx.state,input.planRequestId,'planChangeRequest') : null;
  insist(!request || request.packId === pack.id,'plan_request_mismatch',409);
  const current = {credits:pack.credits,amountCents:pack.amountCents,remaining:pack.remaining,termStartAt:termStart(pack),expiresAt:pack.expiresAt};
  const change = {id:id(),personId:member.id,packId:pack.id,planRequestId:request?.id ?? null,status:'preview',current,...terms,exceptionReason,
    approvedExceptionBy:terms.exception ? tx.who.id : null,basis:basis(tx.state,pack),createdAt:now(),createdBy:tx.who.id};
  tx.put('planChange',{...change,key:JSON.stringify([change.id,change.basis,terms])});
  if (request && request.status === 'requested') tx.put('planChangeRequest',{...request,status:'previewed',planChangeId:change.id});
  return record(tx.state,change.id,'planChange');
}

export function acceptPlanChange(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member','member_acceptance_required',403);
  const change = record(tx.state,input.id,'planChange');
  insist(change.personId === tx.who.personId,'planChange_not_found',404);
  if (change.status !== 'preview') { insist(change.acceptedBy === tx.who.id && input.key === change.key,'plan_change_closed',409); return change; }
  insist(input.key === change.key,'preview_changed',409);
  insist(now() < change.effectiveAt,'preview_expired',409);
  const pack = record(tx.state,change.packId,'pack');
  insist(!pending(tx.state,pack.id),'plan_change_pending',409);
  insist(basis(tx.state,pack) === change.basis,'plan_changed',409);
  const accepted = {...change,status:'accepted',acceptedAt:now(),acceptedBy:tx.who.id};
  tx.put('planChange',accepted); return accepted;
}

/** Applies each accepted change once at its effective instant (command fence and minute sweep). */
export function applyDuePlanChanges(tx: Transaction) {
  const at = now();
  for (const change of list(tx.state,'planChange').filter(c => c.status === 'accepted' && c.effectiveAt <= at)) {
    const pack = record(tx.state,change.packId,'pack');
    const failure = pack.expiresAt !== change.current.expiresAt ? 'term_changed' : change.mode === 'now' && pack.remaining + change.creditsDelta < 0 ? 'allocations_exceed_new_credits' : null;
    if (failure) { tx.put('planChange',{...change,status:'failed',failure,finishedAt:at}); continue; }
    let target = pack;
    if (change.mode === 'now') {
      appendPackEvent(tx,pack,{type:'change',credits:change.creditsDelta,reason:'Plan change '+change.id});
      target = {...record(tx.state,pack.id,'pack'),credits:change.credits,amountCents:change.amountCents};
      tx.put('pack',{...target,planChangeIds:[...(pack.planChangeIds ?? []),change.id]});
    } else {
      target = {id:id(),personId:pack.personId,eligibleServices:pack.eligibleServices ?? [],priorityBooking:pack.priorityBooking === true,creditLedgerVersion:1,creditRevision:0,
        credits:change.credits,remaining:0,amountCents:change.amountCents,termStartAt:change.effectiveAt,expiresAt:change.expiresAt,renewedFromPackId:pack.id,planChangeIds:[change.id],createdAt:at};
      tx.put('pack',target);
      appendPackEvent(tx,target,{type:'grant',credits:change.credits});
    }
    const charge = change.chargeCents === 0 ? null : {id:id(),personId:pack.personId,packId:target.id,planChangeId:change.id,amountCents:change.chargeCents,kind:change.chargeCents < 0 ? 'plan-change-credit' : 'plan-change',createdAt:at};
    if (charge) tx.put('charge',charge);
    tx.put('planChange',{...change,status:'applied',appliedAt:at,appliedPackId:target.id,chargeId:charge?.id ?? null});
    if (change.mode === 'renewal') { settleUnpaid(tx,record(tx.state,target.id,'pack')); promoteAll(tx); }
  }
}

export function planChangeSnapshot(state: State, who: Actor) {
  const visible = (r: RecordData) => who.role === 'owner' || (who.role === 'member' && r.personId === who.personId);
  const stale = (c: RecordData) => c.status === 'preview' && (state.records.get(c.packId)?.data.expiresAt <= now() || now() >= c.effectiveAt
    || !!pending(state,c.packId) || basis(state,state.records.get(c.packId)!.data) !== c.basis);
  return {requests:list(state,'planChangeRequest').filter(visible),changes:list(state,'planChange').filter(visible).map(c => ({...c,stale:stale(c)}))};
}
