import { releaseMakeupCredit } from './makeups';
import { releaseGuest } from './guest-bookings';
import { humanOwner, id, insist, list, now, record, text, type Actor, type RecordData } from './types';
import type { Transaction } from './store';
import { balance } from './money';
import { appendPackEvent, bookingCredit } from './pack-credits';

// Attendance on a booked seat: roster check-in, no-show (ATT-001) and the owner's
// corrections (ATT-003). A booking's `attendance` is its current outcome; every
// correction appends to `corrections`, so the original outcome stays readable.
const fees = ['late_cancel_fee','no_show_fee'];

function teaches(who: Actor, entry: RecordData) {
  insist(who.role === 'owner' || (who.role === 'instructor' && who.personId === entry.instructorId),'instructor_required',403);
}
/** Every check-in door ends here: the seat's reserved credit becomes consumed
 * (no further credit is spent), and a second check-in is refused. */
export function recordCheckin(tx: Transaction, booking: RecordData, entry: RecordData, how: { channel: string; kioskId?: string }): RecordData {
  insist(booking.status === 'booked','confirmed_booking_required',409);
  insist(!booking.checkedInAt,'already_checked_in',409);
  insist(!booking.attendance,'attendance_needs_correction',409);
  bookingCredit(tx,booking,{type:'consume',credits:0,bookingId:booking.id,classId:entry.id});
  const checked = {...booking,attendance:'attended',checkedInAt:now(),checkedInBy:tx.who.id,checkedInByRole:tx.who.role,checkinChannel:how.channel,...(how.kioskId ? {kioskId:how.kioskId} : {})};
  tx.put('booking',checked); return checked;
}
export function checkin(tx: Transaction, input: Record<string,unknown>) {
  const booking = record(tx.state,input.id,'booking'), entry = record(tx.state,booking.classId,'class');
  teaches(tx.who,entry);
  return recordCheckin(tx,booking,entry,{channel:'roster'});
}
/** Once the class has started, a seat nobody checked in is a no-show: the credit
 * is spent and the no-show fee in the booking's terms is added once. */
export function markNoShow(tx: Transaction, input: Record<string,unknown>) {
  const booking = record(tx.state,input.id,'booking'), entry = record(tx.state,booking.classId,'class');
  teaches(tx.who,entry);
  insist(booking.status === 'booked','confirmed_booking_required',409);
  insist(!booking.checkedInAt && !booking.attendance,'attendance_already_recorded',409);
  insist(entry.start <= now(),'class_not_started',409);
  const graceEndsAt = new Date(Date.parse(entry.start)+(booking.cancelTerms?.noShowGraceMinutes ?? 0)*60_000).toISOString();
  insist(graceEndsAt <= now(),'no_show_grace_active',409);
  tx.reached(graceEndsAt);
  bookingCredit(tx,booking,{type:'consume',credits:0,bookingId:booking.id,classId:entry.id,reason:'no_show'});
  const feeCents = booking.cancelTerms?.noShowFeeCents ?? 0;
  if (feeCents > 0) tx.put('charge',{id:id(),personId:booking.sponsorId ?? booking.personId,bookingId:booking.id,classId:entry.id,amountCents:feeCents,reason:'no_show_fee',createdAt:now(),createdBy:tx.who.id});
  const marked = {...booking,attendance:'no_show',noShowAt:now(),noShowBy:tx.who.id,noShowByRole:tx.who.role,noShowFeeCents:feeCents};
  tx.put('booking',marked); return marked;
}

/** The owner (manager until STAFF-001) corrects a no-show to attended or excused,
 * or a late cancel to early. Restoring returns the spent credit to its own pack
 * while that pack is unexpired; the booking's fee is reversed by one negative
 * charge; a refund is recorded as money paid back outside Strap, never sent. */
export function correctAttendance(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const booking = record(tx.state,input.id,'booking'), entry = record(tx.state,booking.classId,'class');
  const reason = text(input.reason,'correction_reason',500), outcome = text(input.outcome,'outcome',20);
  const from = booking.attendance === 'no_show' ? 'no_show' : booking.status === 'cancelled' && booking.cancellation === 'late' ? 'late_cancel' : null;
  insist(from,'nothing_to_correct',409);
  insist(from === 'no_show' ? ['attended','excused'].includes(outcome) : outcome === 'early_cancel','invalid_outcome');
  const restore = outcome === 'excused' || (outcome === 'early_cancel' && !booking.refunded);
  if (restore && booking.packId) {
    const pack = record(tx.state,booking.packId,'pack');
    insist(pack.expiresAt > now(),'pack_expired_extend_first',409);
    tx.future(pack.expiresAt);
    appendPackEvent(tx,pack,{type:'restore',credits:1,bookingId:booking.id,classId:entry.id,reason:'attendance_correction'});
  }
  if (restore && booking.makeupCreditId) releaseMakeupCredit(tx,booking);
  if (restore && booking.guestPackId) releaseGuest(tx,booking);
  const charges = list(tx.state,'charge').filter(c => c.bookingId === booking.id);
  const open = charges.filter(c => fees.includes(c.reason) && !charges.some(r => r.reversesChargeId === c.id));
  const reversedCents = open.reduce((sum,c) => sum+c.amountCents,0);
  for (const fee of open) tx.put('charge',{id:id(),personId:fee.personId,bookingId:booking.id,classId:entry.id,amountCents:-fee.amountCents,reason:'fee_reversal',reversesChargeId:fee.id,note:reason,createdAt:now(),createdBy:tx.who.id});
  let refund: RecordData | null = null;
  if (input.refundReference !== undefined && input.refundReference !== '') {
    const reference = text(input.refundReference,'refund_reference',160);
    insist(reversedCents > 0,'no_fee_to_refund',409);
    const debtors = [...new Set(open.map(c => c.personId))];
    insist(debtors.length === 1,'single_fee_debtor_required',409);
    const debtorId = debtors[0];
    // Only what the studio owes the member after the reversal can be paid back.
    insist(balance(tx.state,debtorId) <= -reversedCents,'fee_not_paid_nothing_to_refund',409);
    insist(!list(tx.state,'payment').some(p => p.reference === reference),'payment_reference_used',409);
    refund = {id:id(),personId:debtorId,amountCents:-reversedCents,reference,kind:'refund',bookingId:booking.id,createdAt:now(),recordedBy:tx.who.id};
    tx.put('payment',refund);
  }
  const correction = {from,to:outcome,reason,by:tx.who.id,byRole:tx.who.role,at:now(),creditRestored:restore,feeReversedCents:reversedCents,refundId:refund?.id ?? null,
    before:{attendance:booking.attendance ?? null,cancellation:booking.cancellation ?? null,refunded:booking.refunded ?? null,feeCents:booking.feeCents ?? null}};
  const current = from === 'no_show'
    ? {...booking,attendance:outcome,...(outcome === 'attended' ? {checkedInAt:entry.start,checkedInBy:tx.who.id} : {})}
    : {...booking,cancellation:'early',refunded:true,feeCents:0};
  const corrected = {...current,corrections:[...(booking.corrections ?? []),correction]};
  tx.put('booking',corrected); return corrected;
}
