import { cancellationEffect } from './booking-policy';
import { debtorOf } from './households';
import { requireStaffRight } from './staff-rights';
import type { Transaction } from './store';
import { insist, now, record, text, type RecordData } from './types';

/** Preview retained terms; elapsed cutoff changes require a fresh review. */
export function appointmentPolicy(tx: Transaction, occurrences: RecordData[], input: Record<string,unknown>, operation: string) {
  const requested = input.mode ?? 'policy';
  insist(['policy','early','late'].includes(String(requested)),'invalid_cancel_choice');
  return occurrences.map(o => {
    const booking = record(tx.state,o.bookingId,'booking'), entry = record(tx.state,o.id,'class');
    const effect = cancellationEffect(booking,entry), waived = effect.waivable && requested === 'early';
    if (waived) requireStaffRight(tx.state,tx.who,'fee-waiver',booking.personId,entry.locationId ?? 'studio');
    const mode = waived ? 'early' : effect.timing;
    const waiver = waived ? {reason:text(input.waiverReason ?? input.reason,'waiver_reason',500),by:tx.who.id,right:'fee-waiver',waivedFeeCents:effect.feeCents,at:now()} : null;
    return {id:o.id,bookingId:booking.id,personId:booking.personId,locationId:entry.locationId ?? 'studio',operation,effect,mode,waiver,
      feeCents:mode === 'late' ? effect.feeCents : 0,creditReturned:operation === 'cancel' && (mode === 'early' || effect.creditReturned)};
  });
}
export function authorizeAppointmentPolicy(tx: Transaction, preview: RecordData) {
  for (const p of preview.policy ?? []) if (p.waiver) requireStaffRight(tx.state,tx.who,'fee-waiver',p.personId,p.locationId);
}
export function validateAppointmentPolicy(tx: Transaction, preview: RecordData) {
  authorizeAppointmentPolicy(tx,preview);
  for (const p of preview.policy ?? []) {
    const booking=record(tx.state,p.bookingId,'booking'),entry=record(tx.state,p.id,'class'),current=cancellationEffect(booking,entry);
    insist(current.key === p.effect.key,'appointment_policy_changed',409);
    if (current.timing === 'early') tx.future(current.cutoffAt); else tx.reached(current.cutoffAt);
  }
}
export function assessAppointmentFee(tx: Transaction, preview: RecordData, policy: RecordData) {
  if (!policy.feeCents) return;
  tx.put('charge',{id:`appointment-fee:${preview.id}:${policy.bookingId}`,personId:debtorOf(tx.state,policy.personId),forPersonId:policy.personId,
    classId:policy.id,bookingId:policy.bookingId,locationId:policy.locationId,amountCents:policy.feeCents,
    reason:preview.operation === 'move' ? 'late_move_fee' : 'late_cancel_fee',appointmentPreviewId:preview.id,cancellationId:preview.id,createdAt:now(),createdBy:tx.who.id});
}
export function reverseAppointmentCancellationFee(tx: Transaction, booking: RecordData, restorationId: string, reason: string) {
  if (!booking.cancellationId) return;
  const charge=tx.state.records.get(`appointment-fee:${booking.cancellationId}:${booking.id}`)?.data;
  if (!charge) return;
  tx.put('charge',{id:`appointment-fee-reversal:${booking.cancellationId}:${booking.id}`,personId:charge.personId,forPersonId:booking.personId,classId:booking.classId,
    bookingId:booking.id,locationId:charge.locationId,amountCents:-charge.amountCents,reason:'fee_reversal',reversesChargeId:charge.id,appointmentRestorationId:restorationId,note:reason,createdAt:now(),createdBy:tx.who.id});
}
