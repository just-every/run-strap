import { canManageMakeup, authorizeMakeup } from './makeup-authority';
import { canManageGuest } from './guest-consent';
import { humanOwner, id, insist, list, now, person, record, text, type RecordData, type State } from './types';
import { cancelTerms, cancellationEffect, insistBookingOpen, priorityOnly, windowOpen } from './booking-policy';
import type { Transaction } from './store';
import { chooseSpot, seatCapacity } from './spots';
import { appendPackEvent, bookingCredit, packCanSeat, packServiceEligible, planBlock } from './pack-credits';
import { bookingHistory, staffReason } from './booking-history';
import { promote, promoteAll } from './waitlist';
export { promoteAll };

export const latestWaiver = (state: State) => list(state,'waiver').sort((a,b) => a.version-b.version || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).at(-1) ?? null;
export function acknowledged(state: State, personId: string) {
  const waiver = latestWaiver(state);
  return !waiver || list(state,'acknowledgement').some(a => a.personId === personId && a.waiverId === waiver.id);
}
/** Packs that can seat this member in this class, earliest expiring first: a
 * credit or plan visit (PLAN-002 hours, upcoming cap and period visits), the
 * class's service, and, inside a priority-only window, priority booking. */
export function eligiblePacks(state: State, personId: string, entry: RecordData) {
  return list(state,'pack').filter(p => p.personId === personId && packServiceEligible(p,entry) && p.expiresAt > entry.start && p.expiresAt > now()
    && (!priorityOnly(state,entry,p) || p.priorityBooking === true) && packCanSeat(state,p,entry))
    .sort((a,b) => a.expiresAt.localeCompare(b.expiresAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
export const eligiblePack = (state: State, personId: string, entry: RecordData) => eligiblePacks(state,personId,entry)[0];
/** The pack a member books with now: the first eligible pack whose own booking
 * window (its plan's rule, else the service or studio rule) is open. */
export function bookingPack(state: State, personId: string, entry: RecordData) {
  const packs = eligiblePacks(state,personId,entry);
  return packs.find(p => windowOpen(state,entry,p)) ?? packs[0] ?? null;
}
/** When no pack can seat: the member's first live plan for this class that
 * refuses it (PLAN-002 hours, upcoming cap or period visits), with its reason. */
export function planRefused(state: State, personId: string, entry: RecordData) {
  for (const pack of list(state,'pack').filter(p => p.personId === personId && p.entitlement && packServiceEligible(p,entry) && p.expiresAt > entry.start && p.expiresAt > now())
    .sort((a,b) => a.expiresAt.localeCompare(b.expiresAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    const code = planBlock(state,pack,entry);
    if (code) return {pack,code};
  }
  return null;
}
function ownMember(tx: Transaction) {
  insist(tx.who.role === 'member' || tx.who.role === 'instructor','member_required',403);
  insist(tx.who.personId,'person_required',403);
  return person(tx.state,tx.who.personId);
}
/** A seat in a room with spots takes the named spot, or the first free one. */
export function seat(tx: Transaction, booking: RecordData, entry: RecordData, pack: RecordData, spot = chooseSpot(tx.state,entry,undefined)) {
  tx.future(entry.start); tx.future(pack.expiresAt);
  appendPackEvent(tx,pack,{type:'reserve',credits:-1,bookingId:booking.id,classId:entry.id});
  const updated = {...booking,status:'booked',packId:pack.id,bookedAt:now(),...(spot ? {spot} : {})};
  tx.put('booking',updated); return updated;
}
export function book(tx: Transaction, input: Record<string,unknown>, forMember?: string) {
  if (forMember) humanOwner(tx.who);
  const member = forMember ? person(tx.state,forMember) : ownMember(tx), entry = record(tx.state,input.classId,'class');
  insist(entry.status !== 'cancelled','class_cancelled',409);
  insist(entry.status === 'published' && entry.start > now(),'class_already_started',409);
  tx.future(entry.start);
  const pack = bookingPack(tx.state,member.id,entry), refused = pack ? null : planRefused(tx.state,member.id,entry);
  insistBookingOpen(tx,entry,!!pack,pack ?? refused?.pack);
  insist(acknowledged(tx.state,member.id),'waiver_acknowledgement_required',409);
  insist(!list(tx.state,'booking').some(b => b.personId === member.id && b.classId === entry.id && b.status !== 'cancelled'),'already_booked',409);
  promote(tx,entry);
  const full = seatCapacity(tx.state,entry).onlineOpen === 0;
  const booking = {id:id(),classId:entry.id,personId:member.id,status:'waitlisted',capacityPool:'online',bookingChannel:'online',cancelTerms:cancelTerms(tx.state,entry,pack),createdAt:now(),sequence:tx.state.version+1};
  if (full) { tx.put('booking',booking); return booking; }
  insist(pack,refused?.code ?? 'eligible_credit_required',409);
  return seat(tx,booking,entry,pack,chooseSpot(tx.state,entry,input.spot));
}
/** SCHED-006: the effect shown before cancelling is the effect applied. The
 * owner acts for front desk with the fee-waiver right until STAFF-001. */
export function cancel(tx: Transaction, input: Record<string,unknown>, parentActionId?: string) {
  const booking = record(tx.state,input.id,'booking');
  insist(tx.who.role !== 'agent' && (tx.who.role === 'owner' || tx.who.personId === booking.personId || (booking.guestPackId && canManageGuest(tx.state,tx.who,booking)) || (booking.makeupCreditId && canManageMakeup(tx.state,tx.who,booking.personId))),'forbidden',403);
  const entry = record(tx.state,booking.classId,'class');
  insist(entry.start > now(),'cancellation_closed',409);
  tx.future(entry.start);
  insist(booking.status !== 'cancelled','already_cancelled',409);
  const effect = cancellationEffect(booking,entry), staff = tx.who.role === 'owner';
  if (booking.makeupCreditId) authorizeMakeup(tx,booking.personId);
  if (staff && booking.guestPackId) {
    text(input.reason,'guest_cancel_reason',500);
    insist(input.mode === 'early' || input.mode === 'late','invalid_cancel_choice');
    if (!effect.waivable) insist(input.mode === effect.timing,'invalid_cancel_choice');
  }
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
  // An unpaid visit (SCHED-010) has no credit to return: cancelling releases it.
  const returned = booking.status === 'booked' && (!!booking.guestPackId || ((!!booking.packId || !!booking.makeupCreditId) && (choice === 'early' || effect.creditReturned)));
  const feeCents = choice === 'late' ? effect.feeCents : 0;
  if (booking.status === 'booked') {
    bookingCredit(tx,booking,returned ? {type:'restore',credits:1,bookingId:booking.id,classId:entry.id} : {type:'consume',credits:0,bookingId:booking.id,classId:entry.id,reason:'late_cancel'});
  }
  const cancellationId = id();
  if (feeCents > 0) tx.put('charge',{id:id(),personId:booking.sponsorId ?? booking.personId,bookingId:booking.id,classId:entry.id,amountCents:feeCents,reason:'late_cancel_fee',cancellationId,createdAt:now(),createdBy:tx.who.id});
  const cancelled = {...booking,cancellationId,status:'cancelled',cancelledAt:now(),cancelledBy:tx.who.id,cancelledByRole:tx.who.role,
    cancellation:booking.status === 'booked' ? choice : 'waitlist',refunded:returned,feeCents,...(waiver ? {waiver} : {})};
  if (staff) staffReason(tx,input);
  tx.put('booking',cancelled); bookingHistory(tx,'cancel',booking,cancelled,input,{id:cancellationId,...(parentActionId ? {parentActionId} : {})}); promote(tx,entry); return cancelled;
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
