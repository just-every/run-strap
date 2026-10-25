import { addDays } from '../zone';
import { appointmentAvailability, appointmentSeriesFields } from './appointment-offers';
import { appointmentBookingVisible, requireAppointmentBooking } from './appointment-access';
import { checkAllocations } from './classes';
import { acknowledged, bookingPack, seat } from './bookings';
import { cancelTerms, insistBookingOpen } from './booking-policy';
import { bookingCredit, packCanSeat, packServiceEligible, packSummary } from './pack-credits';
import { countsCredits } from './entitlements';
import { putNotice, reserveMail, messageBody } from './notices';
import { mailBasis, seriesBasis, wallStart } from './series-model';
import { staffChannel } from './staff-actions';
import { Transaction } from './store';
import { DomainError, humanOwner, id, instant, insist, list, now, person, record, text, type RecordData, type State } from './types';

// Explicit owner save is separate from an offer. Preview allocations live only
// in a cloned transaction; the real save rechecks under the shared revision.
async function facts(tx: Transaction) {
  return JSON.stringify([await seriesBasis(tx.state),list(tx.state,'waiver'),list(tx.state,'acknowledgement'),mailBasis(tx.notices)]);
}
function ownerMember(tx: Transaction, personId: unknown) {
  const member = person(tx.state,personId);
  insist(member.role === 'member','member_required',403);
  insist(['owner','front-desk'].includes(tx.who.role),'appointment_booking_right_required',403);
  insist(acknowledged(tx.state,member.id),'waiver_acknowledgement_required',409);
  return member;
}
function allocate(tx: Transaction, occurrences: RecordData[], personId: string, reservationId: string, channel: string) {
  checkAllocations(tx,occurrences);
  return occurrences.map((entry,index) => {
    const saved = {...entry,privatePersonId:personId,appointmentReservationId:reservationId,appointmentIndex:index,status:'published'};
    const pack = bookingPack(tx.state,personId,saved);
    insist(pack && countsCredits(pack),'private_session_pack_required',409);
    insistBookingOpen(tx,saved,true,pack);
    tx.put('class',saved);
    const booking = seat(tx,{id:id(),classId:saved.id,personId,status:'booked',capacityPool:'desk',bookingChannel:channel,
      madeBy:tx.who.id,madeByRole:tx.who.role,right:'booking',appointmentReservationId:reservationId,cancelTerms:cancelTerms(tx.state,saved,pack),createdAt:now()},saved,pack);
    return {...saved,bookingId:booking.id,packId:pack.id,packLabel:`${pack.credits}-session pack`,status:'booked'};
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
    requireAppointmentBooking(tx,member.id,[String(input.locationId ?? 'studio')]);
    occurrences = appointmentSeriesFields(tx,input).occurrences;
  }
  occurrences = occurrences.map(({availabilityAtCreation,...entry})=>entry as RecordData);
  requireAppointmentBooking(tx,member.id,occurrences.map(o=>o.locationId ?? 'studio'));
  const checked = occurrences.map(entry=>{
    const availability = appointmentAvailability(tx,entry,occurrences), alternatives: {start:string;date:string}[] = [];
    if (!availability.available) for(let day=1;day<=6;day++) {
      const date = addDays(entry.occurrenceDate ?? entry.localDate,day);
      let start: string;
      try { start = instant(wallStart(date,new Intl.DateTimeFormat('en-GB',{timeZone:entry.timeZone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(new Date(entry.start)),entry.timeZone),'start'); }
      catch(error) { if(error instanceof DomainError && error.code === 'local_time_does_not_exist') continue;throw error; }
      const candidate = {...entry,start,end:new Date(Date.parse(start)+Date.parse(entry.end)-Date.parse(entry.start)).toISOString()};
      if (appointmentAvailability(tx,candidate,occurrences).available) alternatives.push({start,date});
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
  requireAppointmentBooking(tx,preview.personId,preview.occurrences.map((o: RecordData)=>o.locationId ?? 'studio'));
  insist(staffChannel({...input,channel:input.channel ?? preview.channel}) === preview.channel,'appointment_channel_changed',409);
  insist(input.key === preview.key && (!operation || preview.operation === operation),'appointment_review_required',409);
  return preview;
}
function notify(tx: Transaction,preview: RecordData,bookingIds: string[],before: unknown,after: unknown) {
  const subject = preview.operation === 'save' ? 'Private series reserved' : preview.operation === 'move' ? 'Private appointment moved' : 'Private appointments cancelled';
  const body = messageBody(tx.state,subject,bookingIds);
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
  requireAppointmentBooking(tx,preview.personId,preview.occurrences.map((o: RecordData)=>o.locationId ?? 'studio'));
  if (preview.offerId) insist(!list(tx.state,'appointmentReservation').some(r => r.offerId === preview.offerId),'appointment_offer_already_saved',409);
  const reservationId = id(), occurrences = allocate(tx,preview.occurrences,preview.personId,reservationId,preview.channel);
  const saved = {id:reservationId,personId:preview.personId,offerId:preview.offerId,status:'active',occurrences,createdAt:now(),createdBy:tx.who.id};
  tx.put('appointmentReservation',saved);
  notify(tx,{...preview,reservationId},occurrences.map(o=>o.bookingId),null,saved);
  tx.put('appointmentPreview',{...preview,status:'confirmed',reservationId}); return saved;
}
function selected(tx: Transaction,input: Record<string,unknown>) {
  const reservation = record(tx.state,input.reservationId,'appointmentReservation');
  ownerMember(tx,reservation.personId);
  requireAppointmentBooking(tx,reservation.personId,reservation.occurrences.map((o: RecordData)=>o.locationId ?? 'studio'));
  const index = reservation.occurrences.findIndex((o: RecordData) => o.id === input.classId);
  insist(index >= 0,'appointment_occurrence_not_found',404);
  const occurrence = reservation.occurrences[index], entry = record(tx.state,occurrence.id,'class'), booking = record(tx.state,occurrence.bookingId,'booking');
  insist(entry.start > now() && entry.status === 'published' && booking.status === 'booked' && !booking.attendance,'appointment_change_closed',409);
  return {reservation,index,occurrence,entry,booking};
}
export async function prepareAppointmentMove(tx: Transaction,input: Record<string,unknown>) {
  const {reservation,entry,booking} = selected(tx,input);
  const start = instant(wallStart(String(input.startDate),input.time,entry.timeZone),'start'), end = new Date(Date.parse(start)+Date.parse(entry.end)-Date.parse(entry.start)).toISOString();
  insist(start !== entry.start,'appointment_unchanged',409);
  const moved = {...entry,start,end,localDate:String(input.startDate)};
  checkAllocations(tx,[moved],[entry.id]);
  const pack = record(tx.state,booking.packId,'pack');
  insist(pack.expiresAt > start && pack.expiresAt > now() && packServiceEligible(pack,moved) && packCanSeat(tx.state,{...pack,remaining:pack.remaining+1},moved,booking.id),'appointment_pack_not_eligible',409);
  const preview = {id:id(),personId:reservation.personId,reservationId:reservation.id,operation:'move',status:'preview',key:id(),channel:staffChannel(input),
    occurrences:[{...moved,bookingId:booking.id,packId:pack.id,status:'booked'}],basis:await facts(tx),createdAt:now(),createdBy:tx.who.id};
  tx.put('appointmentPreview',preview); return preview;
}
export async function prepareAppointmentCancellation(tx: Transaction,input: Record<string,unknown>) {
  const {reservation,index} = selected(tx,input), scope = text(input.scope,'scope',10);
  insist(['this','future'].includes(scope),'invalid_appointment_scope');
  const occurrences = reservation.occurrences.filter((o: RecordData,i: number) => (scope === 'this' ? i === index : i >= index))
    .filter((o: RecordData) => {const b=record(tx.state,o.bookingId,'booking'),c=record(tx.state,o.id,'class');return b.status === 'booked' && !b.attendance && c.start > now();});
  const preview = {id:id(),personId:reservation.personId,reservationId:reservation.id,operation:'cancel',scope,status:'preview',key:id(),channel:staffChannel(input),reason:text(input.reason,'reason',500),
    occurrences,basis:await facts(tx),createdAt:now(),createdBy:tx.who.id};
  tx.put('appointmentPreview',preview); return preview;
}
export async function confirmAppointmentChange(tx: Transaction,input: Record<string,unknown>) {
  const preview = review(tx,input);
  insist(['move','cancel'].includes(preview.operation),'appointment_change_required',409);
  const reservation = record(tx.state,preview.reservationId,'appointmentReservation');
  requireAppointmentBooking(tx,reservation.personId,reservation.occurrences.map((o: RecordData)=>o.locationId ?? 'studio'));
  if (preview.status === 'confirmed') return reservation;
  insist(preview.status === 'preview' && preview.basis === await facts(tx),'appointment_facts_changed',409);
  const changed = new Map<string,RecordData>();
  for (const occurrence of preview.occurrences) {
    const entry = record(tx.state,occurrence.id,'class'), booking = record(tx.state,occurrence.bookingId,'booking');
    insist(entry.start > now() && entry.status === 'published' && booking.status === 'booked' && !booking.attendance,'appointment_change_closed',409);
    tx.future(entry.start);
    if (preview.operation === 'move') {
      checkAllocations(tx,[{...entry,start:occurrence.start,end:occurrence.end,localDate:occurrence.localDate}],[entry.id]);
      const pack = record(tx.state,booking.packId,'pack');
      insist(pack.expiresAt > occurrence.start && pack.expiresAt > now() && packServiceEligible(pack,occurrence) && packCanSeat(tx.state,{...pack,remaining:pack.remaining+1},occurrence,booking.id),'appointment_pack_not_eligible',409);
      tx.future(pack.expiresAt);
      tx.put('class',{...entry,start:occurrence.start,end:occurrence.end,localDate:occurrence.localDate});
      bookingCredit(tx,booking,{type:'transfer',credits:0,bookingId:booking.id,classId:entry.id,reason:'private_appointment_move'});
      changed.set(entry.id,occurrence);
    } else {
      bookingCredit(tx,booking,{type:'restore',credits:1,bookingId:booking.id,classId:entry.id,reason:preview.reason});
      tx.put('booking',{...booking,status:'cancelled',cancelledAt:now(),cancelledBy:tx.who.id,refunded:true,feeCents:0,cancellation:'early'});
      tx.put('class',{...entry,status:'cancelled',cancelledAt:now(),cancelledBy:tx.who.id});
      changed.set(entry.id,{...occurrence,status:'cancelled'});
    }
  }
  const saved = {...reservation,occurrences:reservation.occurrences.map((o: RecordData)=>changed.get(o.id) ?? o),updatedAt:now()};
  tx.put('appointmentReservation',saved);
  notify(tx,preview,preview.occurrences.map((o: RecordData)=>o.bookingId),reservation,saved);
  tx.put('appointmentPreview',{...preview,status:'confirmed'});return saved;
}
export function appointmentSnapshot(state: State,who: import('./types').Actor) {
  const visible = (kind: string) => list(state,kind).filter(r=>(r.occurrences ?? []).every((o: RecordData)=>appointmentBookingVisible(state,who,r.personId,o.locationId ?? 'studio')) && (who.role === 'owner' || who.role === 'front-desk') || (who.role === 'member' && r.personId === who.personId));
  return {appointmentBookingGrants:who.role === 'owner' ? list(state,'appointmentBookingGrant') : [],appointments:visible('appointmentReservation').map(r=>({...r,funding:[...new Set<string>(r.occurrences.map((o: RecordData)=>String(o.packId)))].map(packId=>{const pack=record(state,packId,'pack');return {id:packId,label:`${pack.credits}-session pack`,...packSummary(state,pack)};}),occurrences:r.occurrences.map((o: RecordData)=>{const c=state.records.get(o.id)?.data,b=state.records.get(o.bookingId)?.data;return {...o,start:c?.start ?? o.start,end:c?.end ?? o.end,status:b?.attendance ?? b?.status ?? o.status};})})),appointmentPreviews:['owner','front-desk'].includes(who.role) ? visible('appointmentPreview').map(r=>who.role === 'owner' ? r : {...r,occurrences:r.occurrences.map(({availabilityAtCreation,...o}: RecordData)=>({...o,blockers:(o.blockers ?? []).map(({reason,...b}: RecordData)=>b)}))}) : [],appointmentSeriesOffers:who.role === 'owner' ? [...list(state,'appointmentSeriesOffer'),...list(state,'appointmentOffer').map(o=>({...o,occurrences:[o]}))] : []};
}

/** This runs before canonical request replay, so revocation also fences replays. */
export function authorizeAppointmentCommand(tx: Transaction,input: Record<string,unknown>) {
  const preview = input.id ? tx.state.records.get(String(input.id)) : null;
  const reservation = input.reservationId ? tx.state.records.get(String(input.reservationId)) : null;
  const target = preview?.kind === 'appointmentPreview' ? preview.data : reservation?.kind === 'appointmentReservation' ? reservation.data : null;
  const locations = target ? target.occurrences.map((o: RecordData)=>o.locationId ?? 'studio') : [String(input.locationId ?? 'studio')];
  requireAppointmentBooking(tx,String(target?.personId ?? input.personId ?? ''),locations);
}
