import { legacyStaffGrants } from './staff-rights';
import { addDays } from '../zone';
import { appointmentAvailability, appointmentSeriesFields } from './appointment-offers';
import { appointmentBookingVisible, requireAppointmentBooking } from './appointment-access';
import { appointmentSelection, applyAppointmentChanges, movedAppointments, validateAppointmentChanges } from './appointment-change';
import { checkAllocations } from './classes';
import { acknowledged, bookingPack, planRefused, seat } from './bookings';
import { cancelTerms, insistBookingOpen } from './booking-policy';
import { bookingCredit, packSummary } from './pack-credits';
import { countsCredits } from './entitlements';
import { requireIntake } from './intake';
import { putNotice, reserveMail, messageBody } from './notices';
import { mailBasis, seriesBasis, wallStart } from './series-model';
import { staffChannel } from './staff-actions';
import { Transaction } from './store';
import { DomainError, humanOwner, id, instant, insist, list, now, person, record, text, type RecordData, type State } from './types';

// Explicit owner save is separate from an offer. Preview allocations live only
// in a cloned transaction; the real save rechecks under the shared revision.
async function facts(tx: Transaction) {
  const value = JSON.stringify([await seriesBasis(tx.state),list(tx.state,'waiver'),list(tx.state,'acknowledgement'),
    list(tx.state,'intakeSeries'),list(tx.state,'intakeResponse').map(r=>[r.id,r.personId,r.formId,r.complete]),mailBasis(tx.notices)]);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
}
function ownerMember(tx: Transaction, personId: unknown) {
  const member = person(tx.state,personId);
  insist(member.role === 'member','member_required',403);
  insist(['owner','front-desk','manager','instructor'].includes(tx.who.role),'appointment_booking_right_required',403);
  insist(acknowledged(tx.state,member.id),'waiver_acknowledgement_required',409);
  return member;
}
const fundingLabel = (pack: RecordData) => countsCredits(pack) ? `${pack.credits}-session pack` : pack.entitlement.name ?? (pack.entitlement.kind === 'unlimited' ? 'Unlimited visits' : `${pack.entitlement.visits} visits per ${pack.entitlement.period}`);
function requireOccurrences(tx: Transaction, personId: string, occurrences: RecordData[]) {
  for (const o of occurrences) requireAppointmentBooking(tx,personId,[o.locationId ?? 'studio'],o.instructorId);
}
function allocate(tx: Transaction, occurrences: RecordData[], personId: string, reservationId: string, channel: string): RecordData[] {
  checkAllocations(tx,occurrences.filter(o=>o.status !== 'skipped'));
  return occurrences.map((entry,index): RecordData => {
    if (entry.status === 'skipped') return {...entry,appointmentIndex:index};
    insist(acknowledged(tx.state,personId,entry),'waiver_acknowledgement_required',409);
    requireIntake(tx.state,personId,[entry.service]);
    const saved = {...entry,privatePersonId:personId,appointmentReservationId:reservationId,appointmentIndex:index,status:'published'};
    const pack = bookingPack(tx.state,personId,saved);
    insist(pack,planRefused(tx.state,personId,saved)?.code ?? 'private_session_pack_required',409);
    insistBookingOpen(tx,saved,pack.priorityBooking === true,pack);
    tx.put('class',saved);
    const booking = seat(tx,{id:id(),classId:saved.id,personId,status:'booked',capacityPool:'desk',bookingChannel:channel,
      madeBy:tx.who.id,madeByRole:tx.who.role,right:'booking',appointmentReservationId:reservationId,cancelTerms:cancelTerms(tx.state,saved,pack),createdAt:now()},saved,pack);
    return {...saved,bookingId:booking.id,packId:pack.id,packLabel:fundingLabel(pack),status:'booked'};
  });
}
export async function prepareAppointmentReservation(tx: Transaction,input: Record<string,unknown>) {
  const member = ownerMember(tx,input.personId), channel = staffChannel(input);
  let occurrences: RecordData[], offerId: string|null = null;
  if (input.offerId) {
    humanOwner(tx.who);
    const offered = tx.state.records.get(text(input.offerId,'offer_id',100));
    insist(offered && ['appointmentOffer','appointmentSeriesOffer'].includes(offered.kind),'appointment_offer_not_found',404);
    offerId = offered.data.id;
    insist(!list(tx.state,'appointmentReservation').some(r => r.offerId === offerId),'appointment_offer_already_saved',409);
    occurrences = offered.data.occurrences ?? [offered.data];
  } else {
    requireAppointmentBooking(tx,member.id,[String(input.locationId ?? 'studio')],String(input.instructorId ?? ''));
    occurrences = appointmentSeriesFields(tx,input).occurrences;
  }
  occurrences = occurrences.map(({availabilityAtCreation,...entry})=>entry as RecordData);
  requireOccurrences(tx,member.id,occurrences);
  const checked = occurrences.map(entry=>{
    if (entry.status === 'skipped') return {...entry,available:true,blockers:[],alternatives:[]};
    const availability = appointmentAvailability(tx,entry,occurrences.filter(o=>o.status !== 'skipped')), alternatives: {start:string;date:string}[] = [];
    if (!availability.available) for(let day=1;day<=6;day++) {
      const date = addDays(entry.occurrenceDate ?? entry.localDate,day);
      let start: string;
      try { start = instant(wallStart(date,new Intl.DateTimeFormat('en-GB',{timeZone:entry.timeZone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(new Date(entry.start)),entry.timeZone),'start'); }
      catch(error) { if(error instanceof DomainError && error.code === 'local_time_does_not_exist') continue;throw error; }
      const candidate = {...entry,start,end:new Date(Date.parse(start)+Date.parse(entry.end)-Date.parse(entry.start)).toISOString()};
      if (appointmentAvailability(tx,candidate,occurrences.filter(o=>o.status !== 'skipped')).available) alternatives.push({start,date});
    }
    return {...entry,available:availability.available,blockers:availability.blockers.map(b=>tx.who.role === 'owner' ? b : {id:b.id,kind:b.kind,resource:b.resource,start:b.start,end:b.end}),alternatives,status:availability.available?'available':'conflict'};
  });
  const available = checked.every(o=>o.available), simulation = new Transaction(tx.db,structuredClone(tx.state),tx.who);
  const funded = available ? allocate(simulation,occurrences,member.id,'preview',channel).map(({bookingId,...entry})=>entry) : checked;
  const preview = {id:id(),personId:member.id,offerId,source:input.offerId ? null : Object.fromEntries(['personId','service','instructorId','locationId','room','equipment','startDate','endDate','time','minutes','intervalWeeks','choices','bufferBeforeMinutes','bufferAfterMinutes'].filter(k=>input[k] !== undefined).map(k=>[k,input[k]])),operation:'save',status:'preview',available,occurrences:funded,
    key:id(),channel,basis:await facts(tx),createdAt:now(),createdBy:tx.who.id};
  tx.put('appointmentPreview',preview); return preview;
}
function review(tx: Transaction,input: Record<string,unknown>,operation?: string) {
  const preview = record(tx.state,input.id,'appointmentPreview');
  ownerMember(tx,preview.personId);
  requireOccurrences(tx,preview.personId,preview.occurrences);
  insist(staffChannel({...input,channel:input.channel ?? preview.channel}) === preview.channel,'appointment_channel_changed',409);
  insist(input.key === preview.key && (!operation || preview.operation === operation),'appointment_review_required',409);
  return preview;
}
function notify(tx: Transaction,preview: RecordData,bookingIds: string[],before: unknown,after: unknown) {
  const subject = preview.operation === 'save' ? 'Private series reserved' : preview.operation === 'move' ? 'Private appointments moved' : preview.operation === 'restore' ? 'Private appointments restored' : 'Private appointments cancelled';
  const skipped = (preview.occurrences as RecordData[]).filter(o=>o.status === 'skipped');
  const body = messageBody(tx.state,subject,bookingIds)+(skipped.length ? '\nSkipped appointments:\n'+skipped.map(o=>`${o.occurrenceDate}: ${o.reason}`).join('\n') : '');
  const actionId = id();
  putNotice(tx,{id:`notice:${actionId}`,personId:preview.personId,subject,body,appointmentReservationId:preview.reservationId},true);
  const mail = reserveMail(tx,tx.notices,{id:`mail:${actionId}`,sourceKind:'booking_action',sourceId:actionId,personId:preview.personId,bookingIds,subject,body,prepared:true});
  tx.put('bookingAction',{id:actionId,action:`appointment.${preview.operation}`,actorId:tx.who.id,actorRole:tx.who.role,staffMade:true,right:'booking',
    personId:preview.personId,channel:preview.channel,before,after,reason:preview.reason ?? null,notice:{mailStatus:mail.status},at:now()});
}
export async function confirmAppointmentReservation(tx: Transaction,input: Record<string,unknown>) {
  const preview = review(tx,input,'save');
  if (preview.status === 'confirmed') return record(tx.state,preview.reservationId,'appointmentReservation');
  insist(preview.status === 'preview' && preview.basis === await facts(tx),'appointment_facts_changed',409);
  insist(preview.available,'appointment_conflicts_unresolved',409);
  requireOccurrences(tx,preview.personId,preview.occurrences);
  if (preview.offerId) insist(!list(tx.state,'appointmentReservation').some(r => r.offerId === preview.offerId),'appointment_offer_already_saved',409);
  const reservationId = id(), occurrences = allocate(tx,preview.occurrences,preview.personId,reservationId,preview.channel);
  const saved = {id:reservationId,personId:preview.personId,offerId:preview.offerId,status:'active',occurrences,createdAt:now(),createdBy:tx.who.id};
  tx.put('appointmentReservation',saved);
  notify(tx,{...preview,reservationId},occurrences.filter(o=>o.bookingId).map(o=>o.bookingId),null,saved);
  tx.put('appointmentPreview',{...preview,status:'confirmed',reservationId}); return saved;
}
function selected(tx: Transaction,input: Record<string,unknown>,restore = false) {
  const reservation = record(tx.state,input.reservationId,'appointmentReservation');
  ownerMember(tx,reservation.personId);
  requireOccurrences(tx,reservation.personId,reservation.occurrences);
  return {reservation,...appointmentSelection(tx,reservation,input,restore)};
}
export async function prepareAppointmentMove(tx: Transaction,input: Record<string,unknown>) {
  const {reservation,scope,occurrences:chosen} = selected(tx,input), occurrences = movedAppointments(tx,chosen,input);
  insist(occurrences.some(o=>o.start !== o.before.start),'appointment_unchanged',409);
  validateAppointmentChanges(tx,occurrences,false);
  const preview = {id:id(),personId:reservation.personId,reservationId:reservation.id,operation:'move',scope,status:'preview',key:id(),channel:staffChannel(input),
    occurrences,basis:await facts(tx),createdAt:now(),createdBy:tx.who.id};
  tx.put('appointmentPreview',preview); return preview;
}
export async function prepareAppointmentCancellation(tx: Transaction,input: Record<string,unknown>) {
  const {reservation,scope,occurrences} = selected(tx,input);
  const preview = {id:id(),personId:reservation.personId,reservationId:reservation.id,operation:'cancel',scope,status:'preview',key:id(),channel:staffChannel(input),reason:text(input.reason,'reason',500),
    occurrences,basis:await facts(tx),createdAt:now(),createdBy:tx.who.id};
  tx.put('appointmentPreview',preview); return preview;
}
export async function prepareAppointmentRestore(tx: Transaction,input: Record<string,unknown>) {
  const {reservation,scope,occurrences:chosen} = selected(tx,input,true);
  const occurrences = chosen.map((o: RecordData)=>({...o,...record(tx.state,o.id,'class'),bookingId:o.bookingId,packId:o.packId,status:'booked'}));
  validateAppointmentChanges(tx,occurrences,true);
  const preview = {id:id(),personId:reservation.personId,reservationId:reservation.id,operation:'restore',scope,status:'preview',key:id(),channel:staffChannel(input),
    reason:text(input.reason,'restore_reason',500),occurrences,basis:await facts(tx),createdAt:now(),createdBy:tx.who.id};
  tx.put('appointmentPreview',preview); return preview;
}
export async function confirmAppointmentChange(tx: Transaction,input: Record<string,unknown>) {
  const preview = review(tx,input);
  insist(['move','cancel','restore'].includes(preview.operation),'appointment_change_required',409);
  const reservation = record(tx.state,preview.reservationId,'appointmentReservation');
  requireOccurrences(tx,reservation.personId,reservation.occurrences);
  if (preview.status === 'confirmed') return reservation;
  insist(preview.status === 'preview' && preview.basis === await facts(tx),'appointment_facts_changed',409);
  const changed = new Map<string,RecordData>();
  if (preview.operation !== 'cancel') {
    for (const occurrence of applyAppointmentChanges(tx,preview.occurrences,preview.operation === 'restore',preview.reason)) changed.set(occurrence.id,occurrence);
  } else for (const occurrence of preview.occurrences) {
    const entry = record(tx.state,occurrence.id,'class'), booking = record(tx.state,occurrence.bookingId,'booking');
    insist(entry.start > now() && entry.status === 'published' && booking.status === 'booked' && !booking.attendance,'appointment_change_closed',409);
    tx.future(entry.start);
    bookingCredit(tx,booking,{type:'restore',credits:1,bookingId:booking.id,classId:entry.id,reason:preview.reason});
    tx.put('booking',{...booking,status:'cancelled',cancelledAt:now(),cancelledBy:tx.who.id,refunded:true,feeCents:0,cancellation:'early'});
    tx.put('class',{...entry,status:'cancelled',cancelledAt:now(),cancelledBy:tx.who.id});
    changed.set(entry.id,{...occurrence,status:'cancelled'});
  }
  const saved = {...reservation,occurrences:reservation.occurrences.map((o: RecordData)=>changed.get(o.id) ?? o),updatedAt:now()};
  tx.put('appointmentReservation',saved);
  notify(tx,preview,preview.occurrences.map((o: RecordData)=>o.bookingId),reservation,saved);
  tx.put('appointmentPreview',{...preview,status:'confirmed'});return saved;
}
export function appointmentSnapshot(state: State,who: import('./types').Actor) {
  const staff = ['owner','front-desk','manager','instructor'].includes(who.role);
  const visible = (kind: string) => list(state,kind).filter(r=>staff
    && r.occurrences.every((o: RecordData)=>appointmentBookingVisible(state,who,r.personId,o.locationId ?? 'studio',o.instructorId))
    || who.role === 'member' && r.personId === who.personId);
  const appointments = visible('appointmentReservation').map(r=>({...r,
    funding:[...new Set<string>(r.occurrences.filter((o: RecordData)=>o.packId).map((o: RecordData)=>o.packId))].map(packId=>{
      const pack = record(state,packId,'pack');
      return {id:packId,label:fundingLabel(pack),...packSummary(state,pack)};
    }),
    occurrences:r.occurrences.map((o: RecordData)=>{
      const c = state.records.get(o.id)?.data, b = state.records.get(o.bookingId)?.data;
      return {...o,start:c?.start ?? o.start,end:c?.end ?? o.end,status:b?.attendance ?? b?.status ?? o.status};
    })}));
  const appointmentPreviews = staff ? visible('appointmentPreview').map(r=>who.role === 'owner' ? r : {...r,
    occurrences:r.occurrences.map(({availabilityAtCreation,...o}: RecordData)=>({...o,blockers:(o.blockers ?? []).map(({reason,...b}: RecordData)=>b)}))}) : [];
  return {appointmentBookingGrants:who.role === 'owner' ? legacyStaffGrants(state,'appointmentBookingGrant') : [],appointments,appointmentPreviews,
    appointmentSeriesOffers:who.role === 'owner' ? [...list(state,'appointmentSeriesOffer'),...list(state,'appointmentOffer').map(o=>({...o,occurrences:[o]}))] : []};
}

/** This runs before canonical request replay, so revocation also fences replays. */
export function authorizeAppointmentCommand(tx: Transaction,input: Record<string,unknown>) {
  const preview = input.id ? tx.state.records.get(String(input.id)) : null;
  const reservation = input.reservationId ? tx.state.records.get(String(input.reservationId)) : null;
  const target = preview?.kind === 'appointmentPreview' ? preview.data : reservation?.kind === 'appointmentReservation' ? reservation.data : null;
  if (target) requireOccurrences(tx,target.personId,target.occurrences);
  else requireAppointmentBooking(tx,String(input.personId ?? ''),[String(input.locationId ?? 'studio')],String(input.instructorId ?? ''));
}
