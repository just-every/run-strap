import { locationById } from './locations';
import { hasStaffRight } from './staff-rights';
import type { Transaction } from './store';
import { humanOwner, id, integer, insist, list, now, person, text, type RecordData } from './types';

export interface AppointmentPaymentQuote {
  kind: 'pay-per-visit'; priceId: string; service: string; locationId: string;
  amountCents: number; currency: 'usd'; catalogVersion: number;
}

/** Published rates change by replacement; retained quotes keep their original amount. */
export function saveAppointmentPrice(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  insist(input.id === undefined,'appointment_price_immutable',409);
  const service = text(input.service,'service',160), locationId = locationById(tx.state,input.locationId ?? 'studio').id;
  const amountCents = integer(input.amountCents,'amountCents',1,100_000_000);
  const prior = list(tx.state,'appointmentPrice').filter(rate => rate.service === service && rate.locationId === locationId);
  const saved = {id:id(),service,locationId,amountCents,enabled:true,currency:'usd',
    catalogVersion:Math.max(0,...prior.map(rate => rate.catalogVersion ?? 0))+1,createdAt:now(),createdBy:tx.who.id};
  for (const rate of prior.filter(rate => rate.enabled)) tx.put('appointmentPrice',{...rate,enabled:false,supersededBy:saved.id,supersededAt:saved.createdAt});
  tx.put('appointmentPrice',saved);
  return saved;
}

function participant(tx: Transaction, personId: string) {
  const member = person(tx.state,personId);
  insist(member.role === 'member','member_required');
  insist(!list(tx.state,'household').some(home => home.participantIds.includes(member.id)),
    'appointment_household_payment_authorization_required',403);
  return member;
}
function saleRight(tx: Transaction, personId: string, locationId: string) {
  insist(hasStaffRight(tx.state,tx.who,'sale',personId,locationId),'staff_right_required',403);
}

/** A quote records an obligation on the participant's balance, without collecting money. */
export function quoteAppointmentPayment(tx: Transaction, input: Record<string,unknown>, personId: string, occurrences: RecordData[]): AppointmentPaymentQuote | null {
  if (input.funding === undefined) return null;
  const funding = input.funding as Record<string,unknown>;
  insist(funding && typeof funding === 'object' && !Array.isArray(funding),'invalid_appointment_funding');
  if (funding.kind === 'entitlement') return null;
  insist(funding.kind === 'pay-per-visit','invalid_appointment_funding');
  participant(tx,personId);
  const row = tx.state.records.get(text(funding.priceId,'priceId',100));
  insist(row?.kind === 'appointmentPrice' && row.data.enabled === true,'appointment_price_changed',409);
  const rate = row.data, visits = occurrences.filter(entry => entry.status !== 'skipped');
  insist(visits.length > 0,'appointment_visit_required');
  insist(visits.every(entry => entry.service === rate.service && (entry.locationId ?? 'studio') === rate.locationId),
    'appointment_price_not_eligible',409);
  insist(funding.catalogVersion === undefined || funding.catalogVersion === rate.catalogVersion,'appointment_price_changed',409);
  saleRight(tx,personId,rate.locationId);
  return {kind:'pay-per-visit',priceId:rate.id,service:rate.service,locationId:rate.locationId,
    amountCents:rate.amountCents,currency:'usd',catalogVersion:rate.catalogVersion};
}

const originalId = (booking: RecordData) => `appointment-price:${booking.id}`;
function originalCharge(tx: Transaction, booking: RecordData, entry: RecordData) {
  insist(booking.classId === entry.id,'appointment_payment_booking_changed',409);
  const row = tx.state.records.get(originalId(booking));
  if (!row) return null;
  insist(row.kind === 'charge' && row.data.bookingId === booking.id && row.data.classId === entry.id
    && row.data.personId === booking.personId,'appointment_payment_booking_changed',409);
  return row.data;
}
export function allocateAppointmentPayment(tx: Transaction, booking: RecordData, entry: RecordData, quote: AppointmentPaymentQuote) {
  const current = quoteAppointmentPayment(tx,{funding:quote},booking.personId,[entry]);
  insist(current && JSON.stringify(current) === JSON.stringify(quote),'appointment_price_changed',409);
  const prior = originalCharge(tx,booking,entry);
  if (prior) {
    insist(prior.priceId === quote.priceId && prior.amountCents === quote.amountCents
      && prior.catalogVersion === quote.catalogVersion,'appointment_payment_changed',409);
    return prior;
  }
  const charge = {id:originalId(booking),personId:booking.personId,locationId:quote.locationId,classId:entry.id,bookingId:booking.id,
    appointmentReservationId:booking.appointmentReservationId,reason:'appointment_price',amountCents:quote.amountCents,
    priceId:quote.priceId,catalogVersion:quote.catalogVersion,service:quote.service,currency:quote.currency,
    funding:quote,createdAt:now(),createdBy:tx.who.id};
  tx.put('charge',charge);
  return charge;
}

function paymentEntries(tx: Transaction, original: RecordData) {
  return list(tx.state,'charge').filter(charge => charge.id === original.id || charge.appointmentPriceChargeId === original.id);
}
function priorAdjustment(tx: Transaction, key: string, original: RecordData, identity: string, operation: string) {
  const row = tx.state.records.get(key);
  if (!row) return null;
  insist(row.kind === 'charge' && row.data.appointmentPriceChargeId === original.id && row.data[operation] === identity,
    'appointment_payment_request_changed',409);
  return row.data;
}
/** Cancellation reverses the currently outstanding obligation once; receipts stay intact. */
export function cancelAppointmentPayment(tx: Transaction, booking: RecordData, entry: RecordData, cancellationId: string) {
  const original = originalCharge(tx,booking,entry); if (!original) return null;
  const identity = text(cancellationId,'cancellationId',100), key = `appointment-price-cancel:${encodeURIComponent(booking.id)}:${encodeURIComponent(identity)}`;
  const prior = priorAdjustment(tx,key,original,identity,'cancellationId'); if (prior) return prior;
  const charges = paymentEntries(tx,original), balance = charges.reduce((sum,charge) => sum+charge.amountCents,0);
  insist(balance === 0 || balance === original.amountCents,'appointment_payment_balance_changed',409);
  if (balance === 0) return null;
  const active = charges.find(charge => charge.amountCents > 0 && !charges.some(reversal => reversal.reversesChargeId === charge.id));
  insist(active,'appointment_payment_balance_changed',409);
  const reversal = {id:key,personId:original.personId,locationId:original.locationId,classId:entry.id,bookingId:booking.id,
    appointmentReservationId:original.appointmentReservationId,appointmentPriceChargeId:original.id,
    reversesChargeId:active.id,cancellationId:identity,reason:'appointment_price_reversal',amountCents:-original.amountCents,
    priceId:original.priceId,catalogVersion:original.catalogVersion,currency:'usd',createdAt:now(),createdBy:tx.who.id};
  tx.put('charge',reversal);
  return reversal;
}

/** Restoring a visit reinstates its original amount, independent of later catalog rates. */
export function restoreAppointmentPayment(tx: Transaction, booking: RecordData, entry: RecordData, restorationId: string) {
  const original = originalCharge(tx,booking,entry); if (!original) return null;
  participant(tx,booking.personId); saleRight(tx,booking.personId,original.locationId);
  const identity = text(restorationId,'restorationId',100), key = `appointment-price-restore:${encodeURIComponent(booking.id)}:${encodeURIComponent(identity)}`;
  const prior = priorAdjustment(tx,key,original,identity,'restorationId'); if (prior) return prior;
  const charges = paymentEntries(tx,original), balance = charges.reduce((sum,charge) => sum+charge.amountCents,0);
  insist(balance === 0 || balance === original.amountCents,'appointment_payment_balance_changed',409);
  if (balance === original.amountCents) return null;
  const cancelled = charges.find(charge => charge.amountCents < 0 && !charges.some(restored => restored.reversesChargeId === charge.id));
  insist(cancelled,'appointment_payment_balance_changed',409);
  const restored = {id:key,personId:original.personId,locationId:original.locationId,classId:entry.id,bookingId:booking.id,
    appointmentReservationId:original.appointmentReservationId,appointmentPriceChargeId:original.id,restoresChargeId:original.id,
    reversesChargeId:cancelled.id,restorationId:identity,reason:'appointment_price_restoration',amountCents:original.amountCents,
    priceId:original.priceId,catalogVersion:original.catalogVersion,currency:'usd',createdAt:now(),createdBy:tx.who.id};
  tx.put('charge',restored);
  return restored;
}
