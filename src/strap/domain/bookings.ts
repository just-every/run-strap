import { humanOwner, id, insist, list, now, person, record, text, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { appendPackEvent, packServiceEligible } from './pack-credits';

export const latestWaiver = (state: State) => list(state,'waiver').at(-1) ?? null;
function acknowledged(state: State, personId: string) {
  const waiver = latestWaiver(state);
  return !waiver || list(state,'acknowledgement').some(a => a.personId === personId && a.waiverId === waiver.id);
}
function eligiblePack(state: State, personId: string, entry: RecordData) {
  return list(state,'pack').filter(p => p.personId === personId && p.remaining > 0 && packServiceEligible(p,entry) && p.expiresAt > entry.start && p.expiresAt > now())
    .sort((a,b) => a.expiresAt.localeCompare(b.expiresAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0];
}
function ownMember(tx: Transaction) {
  insist(tx.who.role === 'member' || tx.who.role === 'instructor','member_required',403);
  insist(tx.who.personId,'person_required',403);
  return person(tx.state,tx.who.personId);
}
function seat(tx: Transaction, booking: RecordData, entry: RecordData, pack: RecordData) {
  tx.future(entry.start); tx.future(pack.expiresAt);
  appendPackEvent(tx,pack,{type:'reserve',credits:-1,bookingId:booking.id,classId:entry.id});
  const updated = {...booking,status:'booked',packId:pack.id,bookedAt:now()};
  tx.put('booking',updated); return updated;
}
/** Stable creation-order FIFO among currently eligible members. No credit is
 * consumed until a seat is actually assigned; all promotions share the fence. */
export function promote(tx: Transaction, entry: RecordData) {
  if (entry.start <= now()) return;
  const all = list(tx.state,'booking').filter(b => b.classId === entry.id);
  let vacancies = entry.capacity - all.filter(b => b.status === 'booked').length;
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
  insist(acknowledged(tx.state,member.id),'waiver_acknowledgement_required',409);
  insist(!list(tx.state,'booking').some(b => b.personId === member.id && b.classId === entry.id && b.status !== 'cancelled'),'already_booked',409);
  promote(tx,entry);
  const full = list(tx.state,'booking').filter(b => b.classId === entry.id && b.status === 'booked').length >= entry.capacity;
  const booking = {id:id(),classId:entry.id,personId:member.id,status:'waitlisted',createdAt:now(),sequence:tx.state.version+1};
  if (full) { tx.put('booking',booking); return booking; }
  const pack = eligiblePack(tx.state,member.id,entry);
  insist(pack,'eligible_credit_required',409);
  return seat(tx,booking,entry,pack);
}
export function cancel(tx: Transaction, input: Record<string,unknown>) {
  const booking = record(tx.state,input.id,'booking');
  insist(tx.who.role !== 'agent' && (tx.who.role === 'owner' || tx.who.personId === booking.personId),'forbidden',403);
  const entry = record(tx.state,booking.classId,'class');
  insist(entry.start > now(),'cancellation_closed',409);
  tx.future(entry.start);
  insist(booking.status !== 'cancelled','already_cancelled',409);
  if (booking.status === 'booked') {
    const pack = record(tx.state,booking.packId,'pack');
    appendPackEvent(tx,pack,{type:'restore',credits:1,bookingId:booking.id,classId:entry.id});
  }
  const cancelled = {...booking,status:'cancelled',cancelledAt:now(),refunded:booking.status === 'booked'};
  tx.put('booking',cancelled); promote(tx,entry); return cancelled;
}
export function checkin(tx: Transaction, input: Record<string,unknown>) {
  const booking = record(tx.state,input.id,'booking'), entry = record(tx.state,booking.classId,'class');
  insist(tx.who.role === 'owner' || (tx.who.role === 'instructor' && tx.who.personId === entry.instructorId),'instructor_required',403);
  insist(booking.status === 'booked','confirmed_booking_required',409);
  insist(!booking.checkedInAt,'already_checked_in',409);
  const pack = record(tx.state,booking.packId,'pack');
  appendPackEvent(tx,pack,{type:'consume',credits:0,bookingId:booking.id,classId:entry.id});
  const checked = {...booking,checkedInAt:now(),checkedInBy:tx.who.id}; tx.put('booking',checked); return checked;
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
