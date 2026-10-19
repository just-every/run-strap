import { humanOwner, id, insist, list, now, person, record, text, type RecordData, type State } from './types';
import { cancelTerms, cancellationEffect, insistBookingOpen, priorityOnly } from './booking-policy';
import type { Transaction } from './store';
import { chooseSpot, seatCapacity } from './spots';
import { appendPackEvent, packServiceEligible } from './pack-credits';

export const latestWaiver = (state: State) => list(state,'waiver').sort((a,b) => a.version-b.version || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).at(-1) ?? null;
function acknowledged(state: State, personId: string) {
  const waiver = latestWaiver(state);
  return !waiver || list(state,'acknowledgement').some(a => a.personId === personId && a.waiverId === waiver.id);
}
/** Inside a priority-only window, only a pack sold with priority booking can seat. */
function eligiblePack(state: State, personId: string, entry: RecordData) {
  const priority = priorityOnly(state,entry);
  return list(state,'pack').filter(p => p.personId === personId && p.remaining > 0 && packServiceEligible(p,entry) && p.expiresAt > entry.start && p.expiresAt > now() && (!priority || p.priorityBooking === true))
    .sort((a,b) => a.expiresAt.localeCompare(b.expiresAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
}
function ownMember(tx: Transaction) {
  insist(tx.who.role === 'member' || tx.who.role === 'instructor','member_required',403);
  insist(tx.who.personId,'person_required',403);
  return person(tx.state,tx.who.personId);
}
/** A seat in a room with spots takes the named spot, or the first free one. */
function seat(tx: Transaction, booking: RecordData, entry: RecordData, pack: RecordData, spot = chooseSpot(tx.state,entry,undefined)) {
  tx.future(entry.start); tx.future(pack.expiresAt);
  appendPackEvent(tx,pack,{type:'reserve',credits:-1,bookingId:booking.id,classId:entry.id});
  const updated = {...booking,status:'booked',packId:pack.id,bookedAt:now(),...(spot ? {spot} : {})};
  tx.put('booking',updated); return updated;
}
/** Stable creation-order FIFO among currently eligible members. No credit is
 * consumed until a seat is actually assigned; all promotions share the fence. */
export function promote(tx: Transaction, entry: RecordData) {
  if (entry.start <= now()) return;
  const all = list(tx.state,'booking').filter(b => b.classId === entry.id);
  let vacancies = seatCapacity(tx.state,entry,all).onlineOpen;
  const waiting = all.filter(b => b.status === 'waitlisted').sort((a,b) => a.sequence-b.sequence || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const candidate of waiting) {
    if (vacancies <= 0) break;
    if (!tx.state.people.some(p => p.id === candidate.personId && p.active && !p.erasedAt) || !acknowledged(tx.state,candidate.personId)) continue;
    const pack = eligiblePack(tx.state,candidate.personId,entry);
    if (!pack) continue;
    seat(tx,candidate,entry,pack); vacancies--;
  }
}
export function promoteAll(tx: Transaction) {
  for (const entry of list(tx.state,'class').sort((a,b) => a.start.localeCompare(b.start))) promote(tx,entry);
}
export function book(tx: Transaction, input: Record<string,unknown>) {
  const member = ownMember(tx), entry = record(tx.state,input.classId,'class');
  insist(entry.status === 'published' && entry.start > now(),'class_already_started',409);
  tx.future(entry.start);
  insistBookingOpen(tx,entry,!!eligiblePack(tx.state,member.id,entry));
  insist(acknowledged(tx.state,member.id),'waiver_acknowledgement_required',409);
  insist(!list(tx.state,'booking').some(b => b.personId === member.id && b.classId === entry.id && b.status !== 'cancelled'),'already_booked',409);
  promote(tx,entry);
  const full = seatCapacity(tx.state,entry).onlineOpen === 0;
  const booking = {id:id(),classId:entry.id,personId:member.id,status:'waitlisted',capacityPool:'online',bookingChannel:'online',cancelTerms:cancelTerms(tx.state,entry),createdAt:now(),sequence:tx.state.version+1};
  if (full) { tx.put('booking',booking); return booking; }
  const pack = eligiblePack(tx.state,member.id,entry);
  insist(pack,'eligible_credit_required',409);
  return seat(tx,booking,entry,pack,chooseSpot(tx.state,entry,input.spot));
}
/** The owner operates the desk until STAFF-001 introduces scoped staff roles. */
export function deskBook(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const member = person(tx.state,input.personId), entry = record(tx.state,input.classId,'class');
  insist(member.role === 'member','member_required');
  insist(entry.status === 'published' && entry.start > now(),'class_already_started',409);
  tx.future(entry.start);
  // Staff window overrides arrive with SCHED-010's override right.
  insistBookingOpen(tx,entry,!!eligiblePack(tx.state,member.id,entry));
  insist(acknowledged(tx.state,member.id),'waiver_acknowledgement_required',409);
  insist(!list(tx.state,'booking').some(b => b.personId === member.id && b.classId === entry.id && b.status !== 'cancelled'),'already_booked',409);
  // Existing eligible online waiters have priority over an unallocated online seat.
  promote(tx,entry);
  const capacity = seatCapacity(tx.state,entry);
  insist(capacity.totalOpen > 0,'class_full',409);
  const pack = eligiblePack(tx.state,member.id,entry);
  insist(pack,'eligible_credit_required',409);
  const channel = text(input.channel ?? 'desk','channel',30);
  insist(['desk','phone','inbox'].includes(channel),'invalid_channel');
  const spot = chooseSpot(tx.state,entry,input.spot);
  return seat(tx,{id:id(),classId:entry.id,personId:member.id,status:'waitlisted',
    capacityPool:capacity.heldOpen > 0?'held':'online',bookingChannel:channel,
    madeBy:tx.who.id,right:'booking',cancelTerms:cancelTerms(tx.state,entry),createdAt:now(),sequence:tx.state.version+1},entry,pack,spot);
}
/** SCHED-006: the effect shown before cancelling is the effect applied. The
 * owner acts for front desk with the fee-waiver right until STAFF-001. */
export function cancel(tx: Transaction, input: Record<string,unknown>) {
  const booking = record(tx.state,input.id,'booking');
  insist(tx.who.role !== 'agent' && (tx.who.role === 'owner' || tx.who.personId === booking.personId),'forbidden',403);
  const entry = record(tx.state,booking.classId,'class');
  insist(entry.start > now(),'cancellation_closed',409);
  tx.future(entry.start);
  insist(booking.status !== 'cancelled','already_cancelled',409);
  const effect = cancellationEffect(booking,entry), staff = tx.who.role === 'owner';
  if (input.terms !== undefined) insist(text(input.terms,'terms',40) === effect.key,'cancellation_terms_changed',409);
  if (booking.status === 'booked') { if (effect.timing === 'early') tx.future(effect.cutoffAt); else tx.reached(effect.cutoffAt); }
  let choice = effect.timing, waiver: Record<string,unknown> | null = null;
  if (effect.waivable && staff) {
    const mode = text(input.mode,'cancel_choice',10);
    insist(mode === 'late' || mode === 'early','invalid_cancel_choice');
    if (mode === 'early') {
      choice = 'early';
      waiver = {reason:text(input.reason,'waiver_reason',500),by:tx.who.id,right:'fee-waiver',waivedFeeCents:effect.feeCents,creditReturnedByWaiver:!effect.creditReturned,at:now()};
    }
  } else if (effect.waivable) insist(input.mode === undefined || input.mode === 'late','fee_waiver_right_required',403);
  const returned = booking.status === 'booked' && (choice === 'early' || effect.creditReturned);
  const feeCents = choice === 'late' ? effect.feeCents : 0;
  if (booking.status === 'booked') {
    const pack = record(tx.state,booking.packId,'pack');
    appendPackEvent(tx,pack,returned ? {type:'restore',credits:1,bookingId:booking.id,classId:entry.id} : {type:'consume',credits:0,bookingId:booking.id,classId:entry.id,reason:'late_cancel'});
  }
  if (feeCents > 0) tx.put('charge',{id:id(),personId:booking.personId,bookingId:booking.id,classId:entry.id,amountCents:feeCents,reason:'late_cancel_fee',createdAt:now(),createdBy:tx.who.id});
  const cancelled = {...booking,status:'cancelled',cancelledAt:now(),cancelledBy:tx.who.id,cancelledByRole:tx.who.role,
    cancellation:booking.status === 'booked' ? choice : 'waitlist',refunded:returned,feeCents,...(waiver ? {waiver} : {})};
  tx.put('booking',cancelled); promote(tx,entry); return cancelled;
}
export function publishWaiver(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const waiver = {id:id(),text:text(input.text,'text',20_000),createdAt:now(),createdBy:tx.who.id,version:list(tx.state,'waiver').length+1};
  tx.put('waiver',waiver); return waiver;
}
// Adapted latest-version receipt fence from Willow src/willow/documents.ts,
// acknowledge(), commit 5b116dba308ab2bad264a7662705c87b29304b1e.
export function acknowledgeWaiver(tx: Transaction, input: Record<string,unknown>) {
  const member = ownMember(tx), waiver = latestWaiver(tx.state);
  insist(waiver && waiver.id === input.id,'not_latest_version',409);
  insist(!list(tx.state,'acknowledgement').some(a => a.personId === member.id && a.waiverId === waiver.id),'already_acknowledged',409);
  const receipt = {id:id(),personId:member.id,waiverId:waiver.id,createdAt:now(),actorId:tx.who.id};
  tx.put('acknowledgement',receipt); promoteAll(tx); return receipt;
}
