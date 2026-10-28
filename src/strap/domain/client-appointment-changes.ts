import { appointmentSelection, movedAppointments, validateAppointmentChanges, applyAppointmentChanges } from './appointment-change';
import { appointmentPolicy, validateAppointmentPolicy, assessAppointmentFee } from './appointment-policy';
import { bookingCredit } from './pack-credits';
import { clientAppointmentAccess, clientAppointmentNotice } from './client-appointments';
import { staffChannel } from './staff-actions';
import type { Transaction } from './store';
import { id, insist, now, record, text, type RecordData } from './types';

const channelFor = (tx: Transaction, input: Record<string,unknown>) => tx.who.role === 'member' ? 'online' : staffChannel(input);
const currentFacts = (tx: Transaction, reservation: RecordData) => JSON.stringify(reservation.occurrences.filter((o: RecordData)=>o.bookingId).map((o: RecordData)=>[
  record(tx.state,o.id,'class'),record(tx.state,o.bookingId,'booking')]));

/** Member and staff review exactly the same retained policy and destination. */
export function prepareClientAppointmentChange(tx: Transaction, input: Record<string,unknown>, operation: 'move'|'cancel') {
  const reservation = record(tx.state,input.reservationId,'appointmentReservation');
  insist(reservation.clientOfferId,'client_appointment_required',403);
  clientAppointmentAccess(tx,reservation);
  if (tx.who.role === 'member') insist(!input.suppressNotice && (!input.mode || input.mode === 'policy'),'member_policy_override_forbidden',403);
  const selected = appointmentSelection(tx,reservation,input);
  const occurrences = operation === 'move' ? movedAppointments(tx,selected.occurrences,input) : selected.occurrences;
  if (operation === 'move') {
    insist(occurrences.some((o: RecordData)=>o.start !== o.before.start),'appointment_unchanged',409);
    validateAppointmentChanges(tx,occurrences,false);
  }
  insist(!input.suppressNotice,'client_appointment_notice_required',403);
  const preview = {id:id(),personId:reservation.personId,reservationId:reservation.id,operation,scope:selected.scope,status:'preview',key:id(),
    channel:channelFor(tx,input),createdBy:tx.who.id,createdAt:now(),occurrences,policy:appointmentPolicy(tx,selected.occurrences,input,operation),
    reason:operation === 'cancel' ? text(input.reason,'reason',500) : 'Requested appointment move',basis:currentFacts(tx,reservation)};
  tx.put('clientAppointmentPreview',preview); return preview;
}

export function confirmClientAppointmentChange(tx: Transaction, input: Record<string,unknown>) {
  const preview = record(tx.state,input.id,'clientAppointmentPreview');
  clientAppointmentAccess(tx,preview);
  insist(preview.createdBy === tx.who.id && preview.channel === channelFor(tx,input),'appointment_review_actor_changed',403);
  insist(preview.key === input.key,'appointment_review_required',409);
  const reservation = record(tx.state,preview.reservationId,'appointmentReservation');
  if (preview.status === 'confirmed') return reservation;
  insist(preview.status === 'preview' && preview.basis === currentFacts(tx,reservation),'appointment_facts_changed',409);
  validateAppointmentPolicy(tx,preview);
  const bookingBefore = preview.occurrences.map((o: RecordData)=>record(tx.state,o.bookingId,'booking'));
  let changed: RecordData[];
  if (preview.operation === 'move') changed = applyAppointmentChanges(tx,preview.occurrences,false);
  else {
    changed = preview.occurrences.map((occurrence: RecordData)=>{
      const entry = record(tx.state,occurrence.id,'class'), booking = record(tx.state,occurrence.bookingId,'booking');
      insist(entry.start > now() && booking.status === 'booked' && !booking.attendance,'appointment_change_closed',409);
      tx.future(entry.start);
      const policy = preview.policy.find((p: RecordData)=>p.bookingId === booking.id);
      bookingCredit(tx,booking,{type:policy.creditReturned ? 'restore' : 'consume',credits:policy.creditReturned ? 1 : 0,bookingId:booking.id,classId:entry.id,reason:preview.reason});
      tx.put('booking',{...booking,status:'cancelled',cancelledAt:now(),cancelledBy:tx.who.id,cancelledByRole:tx.who.role,
        refunded:policy.creditReturned,feeCents:policy.feeCents,cancellation:policy.mode,cancellationId:preview.id,waiver:policy.waiver});
      tx.put('class',{...entry,status:'cancelled',cancelledAt:now(),cancelledBy:tx.who.id});
      return {...occurrence,status:'cancelled'};
    });
  }
  for (const policy of preview.policy) assessAppointmentFee(tx,preview,policy);
  const byId = new Map(changed.map(o=>[o.id,o]));
  const saved = {...reservation,occurrences:reservation.occurrences.map((o: RecordData)=>byId.get(o.id) ?? o),updatedAt:now()};
  tx.put('appointmentReservation',saved);
  clientAppointmentNotice(tx,preview.operation,saved,reservation,saved,preview.channel,preview.id,bookingBefore,preview.reason);
  tx.put('clientAppointmentPreview',{...preview,status:'confirmed'}); return saved;
}
