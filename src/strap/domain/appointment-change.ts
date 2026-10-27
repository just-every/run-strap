import { addDays, localDate } from '../zone';
import { acknowledged } from './bookings';
import { insistBookingOpen } from './booking-policy';
import { checkAllocations } from './classes';
import { countsCredits } from './entitlements';
import { requireIntake } from './intake';
import { bookingCredit, packCanSeat, packServiceEligible } from './pack-credits';
import { civilDate, wallStart } from './series-model';
import type { Transaction } from './store';
import { instant, insist, now, record, text, type RecordData } from './types';

const unused = (entry: RecordData, booking: RecordData, restore: boolean) => entry.start > now() && !booking.attendance
  && (restore ? entry.status === 'cancelled' && booking.status === 'cancelled' && booking.cancellation === 'early' && booking.refunded === true
    : entry.status === 'published' && booking.status === 'booked');

/** The stored occurrence order survives alternatives, moves and cancellations. */
export function appointmentSelection(tx: Transaction, reservation: RecordData, input: Record<string,unknown>, restore = false) {
  const index = reservation.occurrences.findIndex((o: RecordData) => o.id === input.classId);
  insist(index >= 0,'appointment_occurrence_not_found',404);
  const scope = text(input.scope ?? 'this','scope',10);
  insist(['this','future'].includes(scope),'invalid_appointment_scope');
  const anchor = reservation.occurrences[index];
  insist(anchor.bookingId,'appointment_change_closed',409);
  insist(unused(record(tx.state,anchor.id,'class'),record(tx.state,anchor.bookingId,'booking'),restore),'appointment_change_closed',409);
  const occurrences = reservation.occurrences.filter((o: RecordData,i: number) => (scope === 'this' ? i === index : i >= index) && !!o.bookingId)
    .filter((o: RecordData) => unused(record(tx.state,o.id,'class'),record(tx.state,o.bookingId,'booking'),restore));
  return {scope,occurrences};
}

export function movedAppointments(tx: Transaction, occurrences: RecordData[], input: Record<string,unknown>) {
  const first = record(tx.state,occurrences[0].id,'class'), date = civilDate(input.startDate);
  const days = (Date.parse(date)-Date.parse(localDate(first.start,first.timeZone)))/86_400_000;
  return occurrences.map(occurrence => {
    const entry = record(tx.state,occurrence.id,'class');
    const date = addDays(localDate(entry.start,entry.timeZone),days);
    const start = instant(wallStart(date,input.time,entry.timeZone),'start');
    return {...entry,localDate:date,start,end:new Date(Date.parse(start)+Date.parse(entry.end)-Date.parse(entry.start)).toISOString(),
      bookingId:occurrence.bookingId,packId:occurrence.packId,packLabel:occurrence.packLabel,status:'booked',
      before:{start:entry.start,end:entry.end,localDate:localDate(entry.start,entry.timeZone)}};
  });
}

/** Validate all destinations together, then project every held visit before
 * checking an allowance. A move cannot temporarily double-count its own visits. */
export function validateAppointmentChanges(tx: Transaction, occurrences: RecordData[], restore: boolean) {
  checkAllocations(tx,occurrences,occurrences.map(o => o.id));
  const projected = structuredClone(tx.state);
  for (const occurrence of occurrences) {
    const entry = record(tx.state,occurrence.id,'class'), booking = record(tx.state,occurrence.bookingId,'booking');
    insist(unused(entry,booking,restore),'appointment_change_closed',409);
    insist(entry.appointmentReservationId === booking.appointmentReservationId && booking.classId === entry.id,'appointment_change_closed',409);
    projected.records.set(entry.id,{kind:'class',data:{...entry,start:occurrence.start,end:occurrence.end,localDate:occurrence.localDate,status:'published'}});
    projected.records.set(booking.id,{kind:'booking',data:{...booking,status:'booked',refunded:false}});
    tx.future(entry.start);
  }
  const remaining = new Map<string,number>();
  for (const occurrence of occurrences) {
    const booking = record(tx.state,occurrence.bookingId,'booking'), pack = record(tx.state,booking.packId,'pack');
    insist(acknowledged(tx.state,booking.personId,occurrence),'waiver_acknowledgement_required',409);
    requireIntake(tx.state,booking.personId,[occurrence.service]);
    const available = remaining.get(pack.id) ?? pack.remaining;
    insist(pack.personId === booking.personId && pack.expiresAt > occurrence.start && pack.expiresAt > now()
      && packServiceEligible(pack,occurrence) && (!restore || !countsCredits(pack) || available > 0)
      && packCanSeat(projected,{...pack,remaining:restore ? available : pack.remaining+1},occurrence,booking.id),'appointment_pack_not_eligible',409);
    if (restore && countsCredits(pack)) remaining.set(pack.id,available-1);
    insistBookingOpen(tx,occurrence,pack.priorityBooking === true,pack);
    tx.future(pack.expiresAt);
  }
}

/** Original booking, class and funding identities are reused by both changes. */
export function applyAppointmentChanges(tx: Transaction, occurrences: RecordData[], restore: boolean, reason?: string) {
  validateAppointmentChanges(tx,occurrences,restore);
  return occurrences.map(occurrence => {
    const entry = record(tx.state,occurrence.id,'class'), booking = record(tx.state,occurrence.bookingId,'booking');
    if (restore) {
      const {cancelledAt,cancelledBy,cancelledByRole,cancellation,refunded,feeCents,...active} = booking;
      bookingCredit(tx,booking,{type:'reserve',credits:-1,bookingId:booking.id,classId:entry.id,reason});
      tx.put('booking',{...active,status:'booked',restoredAt:now(),restoredBy:tx.who.id,
        appointmentRestorations:[...(booking.appointmentRestorations ?? []),{at:now(),actorId:tx.who.id,reason,
          cancellation:{cancelledAt,cancelledBy,cancelledByRole,cancellation,refunded,feeCents}}]});
      const {cancelledAt:classCancelledAt,cancelledBy:classCancelledBy,...published} = entry;
      tx.put('class',{...published,status:'published'});
      return {...published,bookingId:booking.id,packId:booking.packId,packLabel:occurrence.packLabel,status:'booked'};
    } else {
      tx.put('class',{...entry,start:occurrence.start,end:occurrence.end,localDate:occurrence.localDate});
      bookingCredit(tx,booking,{type:'transfer',credits:0,bookingId:booking.id,classId:entry.id,reason:'private_appointment_move'});
    }
    const {before,...saved} = occurrence;
    return {...saved,status:'booked'};
  });
}
