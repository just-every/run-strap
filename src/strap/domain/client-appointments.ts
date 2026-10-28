import { authorizeAppointmentPolicy } from './appointment-policy';
import { appointmentBookingVisible, requireAppointmentBooking } from './appointment-access';
import { appointmentAvailability } from './appointment-offers';
import { acknowledged, bookingPack, planRefused, seat } from './bookings';
import { cancelTerms, insistBookingOpen } from './booking-policy';
import { checkAllocations } from './classes';
import { requireIntake } from './intake';
import { balance, recordPayment } from './money';
import { putNotice, reserveMail, messageBody } from './notices';
import { staffChannel, requestBasis } from './staff-actions';
import { Transaction } from './store';
import { humanOwner, id, integer, insist, list, now, person, record, text, type Actor, type RecordData, type State } from './types';

export function clientAppointmentAccess(tx: Transaction, target: RecordData) {
  person(tx.state,target.personId);
  if (tx.who.role === 'member') {
    insist(tx.who.personId === target.personId,'forbidden',403);
  } else for (const occurrence of target.occurrences) {
    requireAppointmentBooking(tx,target.personId,[occurrence.locationId ?? 'studio'],occurrence.instructorId);
  }
}

/** Resolve stored scope before canonical staff replay, never a supplied identity. */
export function authorizeClientAppointment(tx: Transaction, name: string, input: Record<string,unknown>) {
  if (name.endsWith('.deliver') || name.endsWith('.deposit.record')) { humanOwner(tx.who); return; }
  const row = tx.state.records.get(String(input.id ?? input.reservationId));
  insist(row && ['clientAppointmentOffer','clientAppointmentPreview','appointmentReservation'].includes(row.kind),'forbidden',403);
  insist(row.kind !== 'appointmentReservation' || row.data.clientOfferId,'forbidden',403);
  if (input.personId !== undefined) insist(input.personId === row.data.personId,'forbidden',403);
  clientAppointmentAccess(tx,row.data);
  authorizeAppointmentPolicy(tx,row.data);
}

function offeredOccurrence(source: RecordData) {
  return Object.fromEntries(['service','title','start','end','timeZone','localDate','occurrenceDate','originalStart','durationMinutes',
    'instructorId','instructorName','instructorVersion','locationId','room','equipment','bufferBeforeMinutes','bufferAfterMinutes','capacity','onlineCapacity','status','reason'].filter(k=>source[k] !== undefined).map(k=>[k,source[k]])) as RecordData;
}

/** Simulate only in a cloned transaction when delivering: no holds or debits. */
function allocate(tx: Transaction, offer: RecordData, reservationId: string, channel: string, reviewing = false) {
  const live = offer.occurrences.filter((o: RecordData)=>o.status !== 'skipped');
  checkAllocations(tx,live);
  return offer.occurrences.map((occurrence: RecordData): RecordData => {
    if (occurrence.status === 'skipped') return occurrence;
    insist(appointmentAvailability(tx,occurrence).available,'appointment_unavailable',409);
    insist(acknowledged(tx.state,offer.personId,occurrence),'waiver_acknowledgement_required',409);
    requireIntake(tx.state,offer.personId,[occurrence.service]);
    const entry = {...occurrence,status:'published',privatePersonId:offer.personId,appointmentReservationId:reservationId};
    const pack = bookingPack(tx.state,offer.personId,entry);
    insist(pack,planRefused(tx.state,offer.personId,entry)?.code ?? 'private_session_pack_required',409);
    const terms = cancelTerms(tx.state,entry,pack);
    if (!reviewing) insist(occurrence.packId === pack.id && JSON.stringify(occurrence.cancelTerms) === JSON.stringify(terms),'appointment_terms_changed',409);
    insistBookingOpen(tx,entry,pack.priorityBooking === true,pack);
    tx.put('class',entry);
    const booking = seat(tx,{id:id(),classId:entry.id,personId:offer.personId,status:'booked',capacityPool:channel === 'online' ? 'online' : 'desk',
      bookingChannel:channel,madeBy:tx.who.id,madeByRole:tx.who.role,appointmentReservationId:reservationId,cancelTerms:terms,createdAt:now()},entry,pack);
    return {...entry,bookingId:booking.id,packId:pack.id,packLabel:pack.entitlement?.name ?? 'Session pack',cancelTerms:terms,status:'booked'};
  });
}

export function deliverClientAppointment(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const member = person(tx.state,input.personId);
  insist(member.role === 'member','member_required',403);
  const requestId = text(input.requestId,'requestId',100), basis = requestBasis(input);
  const prior = list(tx.state,'clientAppointmentOffer').find(o=>o.createdBy === tx.who.id && o.requestId === requestId);
  if (prior) { insist(prior.requestBasis === basis,'appointment_request_changed',409); return prior; }
  const row = tx.state.records.get(text(input.offerId,'offerId',100));
  insist(row && ['appointmentOffer','appointmentSeriesOffer'].includes(row.kind),'appointment_offer_not_found',404);
  const depositCents = integer(input.depositCents ?? 0,'depositCents',0,100_000_000);
  insist(!depositCents || !list(tx.state,'household').some(h=>h.participantIds.includes(member.id)),'appointment_household_payment_authorization_required',403);
  insist(depositCents <= Math.max(0,balance(tx.state,member.id)),'deposit_exceeds_outstanding_balance',409);
  const offer: RecordData = {id:id(),personId:member.id,sourceOfferId:row.data.id,key:id(),depositCents,status:'delivered',createdAt:now(),createdBy:tx.who.id,requestId,requestBasis:basis,
    occurrences:(row.data.occurrences ?? [row.data]).map((o: RecordData)=>({...offeredOccurrence(o),id:id()}))};
  const simulation = new Transaction(tx.db,structuredClone(tx.state),tx.who);
  offer.occurrences = allocate(simulation,offer,'preview','online',true).map(({bookingId,appointmentReservationId,privatePersonId,...o}: RecordData)=>o);
  tx.put('clientAppointmentOffer',offer);
  putNotice(tx,{id:'appointment-offer:'+offer.id,personId:member.id,subject:'Private appointment invitation',body:'Review the exact appointment and terms in your account. The invitation holds no place and sends no payment.',clientAppointmentOfferId:offer.id},true);
  return offer;
}

export function acceptClientAppointment(tx: Transaction, input: Record<string,unknown>) {
  const offer = record(tx.state,input.id,'clientAppointmentOffer');
  clientAppointmentAccess(tx,offer);
  insist(input.confirm === true && input.key === offer.key,'appointment_acceptance_required',409);
  if (offer.status === 'accepted') return record(tx.state,offer.reservationId,'appointmentReservation');
  insist(offer.status === 'delivered','appointment_offer_closed',409);
  const reservationId = id(), channel = tx.who.role === 'member' ? 'online' : staffChannel(input);
  const occurrences = allocate(tx,offer,reservationId,channel);
  const saved = {id:reservationId,personId:offer.personId,clientOfferId:offer.id,status:'saved',occurrences,createdAt:now(),createdBy:tx.who.id,
    acceptedAt:now(),acceptedBy:tx.who.id,acceptedByRole:tx.who.role,channel,deposit:{amountCents:offer.depositCents,status:offer.depositCents ? 'due' : 'not_required'}};
  tx.put('appointmentReservation',saved);
  tx.put('clientAppointmentOffer',{...offer,status:'accepted',reservationId});
  clientAppointmentNotice(tx,'save',saved,null,saved,channel,offer.id);
  return saved;
}

export function clientAppointmentNotice(tx: Transaction, operation: string, reservation: RecordData, before: unknown, after: unknown, channel: string, identity: string, bookingBefore: RecordData[] = [], reason: string | null = null) {
  const subject = operation === 'save' ? 'Private appointment reserved' : operation === 'move' ? 'Private appointment moved' : 'Private appointment cancelled';
  const actionId = 'client-appointment-action:'+identity;
  const bookingIds = reservation.occurrences.filter((o: RecordData)=>o.bookingId).map((o: RecordData)=>o.bookingId);
  const body = messageBody(tx.state,subject,bookingIds);
  const mail = reserveMail(tx,tx.notices,{id:'client-appointment-mail:'+identity,sourceKind:'booking_action',sourceId:actionId,personId:reservation.personId,bookingIds,subject,body,prepared:true});
  putNotice(tx,{id:'client-appointment-notice:'+identity,personId:reservation.personId,subject,
    body,appointmentReservationId:reservation.id},true);
  tx.put('bookingAction',{id:actionId,action:'appointment.'+operation,actorId:tx.who.id,actorRole:tx.who.role,
    staffMade:tx.who.role !== 'member',right:tx.who.role === 'member' ? null : 'booking',personId:reservation.personId,channel,before,after,
    notice:{status:'in_app',mailStatus:mail.status},reason,at:now()});
  if (operation === 'cancel') for (const before of bookingBefore) {
    const after = record(tx.state,before.id,'booking');
    tx.put('bookingAction',{id:`appointment-change:${identity}:${before.id}`,parentActionId:actionId,appointmentReservationId:reservation.id,
      bookingId:before.id,classId:before.classId,personId:before.personId,action:'cancel',actorId:tx.who.id,actorRole:tx.who.role,
      staffMade:tx.who.role !== 'member',right:tx.who.role === 'member' ? null : 'booking',channel,reason,at:after.cancelledAt,type:after.cancellation,
      feeCents:after.feeCents,creditReturned:after.refunded,waiver:after.waiver,before,after,mailSourceId:actionId,notice:{status:'in_app',mailStatus:mail.status}});
  }
}

/** Actual outside money is one linked receipt, never a processor operation. */
export function recordAppointmentDeposit(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const reservation = record(tx.state,input.reservationId,'appointmentReservation');
  insist(reservation.clientOfferId && reservation.occurrences.some((o: RecordData)=>record(tx.state,o.bookingId,'booking').status === 'booked'),'appointment_deposit_closed',409);
  person(tx.state,reservation.personId);
  insist(!list(tx.state,'household').some(h=>h.participantIds.includes(reservation.personId)),'appointment_household_payment_authorization_required',403);
  const amountCents = integer(input.amountCents,'amountCents',1,100_000_000), reference = text(input.reference,'reference',160);
  insist(amountCents === reservation.deposit.amountCents,'appointment_deposit_amount_changed',409);
  const prior = reservation.deposit.paymentId ? record(tx.state,reservation.deposit.paymentId,'payment') : null;
  if (prior) { insist(prior.reference === reference && prior.amountCents === amountCents,'appointment_deposit_already_recorded',409); return reservation; }
  insist(balance(tx.state,reservation.personId) >= amountCents,'deposit_balance_already_covered',409);
  const payment = recordPayment(tx,{personId:reservation.personId,locationId:reservation.occurrences[0].locationId,amountCents,reference});
  tx.put('payment',{...payment,kind:'appointment_deposit',appointmentReservationId:reservation.id,clientOfferId:reservation.clientOfferId});
  const saved = {...reservation,deposit:{...reservation.deposit,status:'recorded',paymentId:payment.id,reference}};
  tx.put('appointmentReservation',saved);
  tx.put('bookingAction',{id:'appointment-deposit:'+payment.id,action:'appointment.deposit',actorId:tx.who.id,actorRole:tx.who.role,
    staffMade:true,right:'collection',personId:reservation.personId,channel:staffChannel(input),before:reservation,after:saved,at:now()});
  return saved;
}

export function clientAppointmentSnapshot(state: State, who: Actor) {
  const visible = (row: RecordData) => !!state.people.find(p=>p.id === row.personId && p.active && !p.erasedAt) && (who.role === 'member' ? row.personId === who.personId
    : row.occurrences.every((o: RecordData)=>appointmentBookingVisible(state,who,row.personId,o.locationId ?? 'studio',o.instructorId)));
  return {clientAppointmentOffers:list(state,'clientAppointmentOffer').filter(visible).map(({requestBasis,sourceOfferId,...o})=>o),
    clientAppointmentPreviews:list(state,'clientAppointmentPreview').filter(visible)};
}
