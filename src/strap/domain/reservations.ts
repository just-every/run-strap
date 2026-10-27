import { requireClassRight, classRightVisible, staffIdentity } from './staff-command-access';
// SCHED-005: review and commit a finite set of existing class occurrences.
// The real single-booking and cancellation doors remain the policy authority.
import { book, bookingPack, cancel, planRefused } from './bookings';
import { cancellationEffect, insistBookingOpen } from './booking-policy';
import { packServiceEligible } from './pack-credits';
import { confirmBooking } from './notices';
import { civilDate, mailBasis, seriesBasis } from './series-model';
import { staffChannel } from './staff-actions';
import { Transaction } from './store';
import { DomainError, humanOwner, id, insist, list, now, person, record, type RecordData, type State } from './types';

function member(tx: Transaction, input: Record<string,unknown>) {
  const staff = staffIdentity(tx.state,tx.who);
  insist(tx.who.role === 'member' || staff,'member_or_owner_required',403);
  if (!staff) insist(!input.personId || input.personId === tx.who.personId,'forbidden',403);
  const found = person(tx.state,staff ? input.personId : tx.who.personId);
  insist(found.role === 'member','member_required',403); return found;
}
async function basis(state: State, tx: Transaction) {
  const facts = JSON.stringify([await seriesBasis(state),list(state,'waiver'),list(state,'acknowledgement'),mailBasis(tx.notices)]);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(facts))),byte => byte.toString(16).padStart(2,'0')).join('');
}
function selection(state: State, input: Record<string,unknown>) {
  const first = record(state,input.classId,'class');
  insist(first.seriesId,'recurring_timetable_required',409);
  const series = record(state,first.seriesId,'series'), throughDate = civilDate(input.throughDate);
  insist(first.start > now(),'class_already_started',409);
  insist(throughDate >= first.occurrenceDate && throughDate <= series.endDate,'choose_published_series_end_date',409);
  const classes = list(state,'class').filter(c => c.seriesId === series.id && c.seriesIndex >= first.seriesIndex && c.occurrenceDate <= throughDate).sort((a,b) => a.seriesIndex-b.seriesIndex);
  insist(classes.length > 0 && classes.length <= 104,'invalid_reservation_occurrences');
  return {series,classes,throughDate};
}
type Outcome = {classId:string;date:string;start:string;title:string;status:string;reason:string|null;packId?:string|null;cancelTerms?:any;bookingId?:string};
function attempt(tx: Transaction, entry: RecordData, personId: string, channel = 'online'): Outcome {
  const outcome = {classId:entry.id,date:entry.occurrenceDate,start:entry.start,title:entry.title};
  if (entry.status === 'cancelled') return {...outcome,status:'skipped',reason:'class_cancelled'};
  if (entry.start <= now()) return {...outcome,status:'skipped',reason:'class_already_started'};
  const currentPack = bookingPack(tx.state,personId,entry), refusal = planRefused(tx.state,personId,entry);
  try { insistBookingOpen(tx,entry,!!currentPack,currentPack ?? refusal?.pack); }
  catch (error) {
    if (error instanceof DomainError && error.code === 'booking_window_closed') return {...outcome,status:'skipped',reason:error.code};
    throw error;
  }
  // A full class cannot turn a service/expiry/hour refusal into an eligible waitlist.
  const live = list(tx.state,'pack').filter(p => p.personId === personId && packServiceEligible(p,entry) && p.expiresAt > entry.start && p.expiresAt > now());
  if (!live.length) return {...outcome,status:'skipped',reason:'no_eligible_entitlement'};
  const pack = bookingPack(tx.state,personId,entry), refused = planRefused(tx.state,personId,entry);
  if (!pack && refused?.code === 'outside_plan_hours') return {...outcome,status:'skipped',reason:refused.code};

  try {
    let b: RecordData = book(tx,{classId:entry.id},staffIdentity(tx.state,tx.who) ? personId : undefined);
    if (staffIdentity(tx.state,tx.who)) { b = {...b,bookingChannel:channel,madeBy:tx.who.id,madeByRole:tx.who.role,right:'booking'}; tx.put('booking',b); }
    return {...outcome,status:b.status,reason:null,packId:b.packId ?? null,cancelTerms:b.cancelTerms,bookingId:b.id};
  } catch (error) {
    if (error instanceof DomainError && ['eligible_credit_required','plan_visits_used','plan_upcoming_limit_reached'].includes(error.code)) throw new DomainError('series_would_overdraw_entitlement',409);
    // Booking horizon is a refusal of the complete proposal, never a hidden skip.
    if (error instanceof DomainError && ['waiver_acknowledgement_required','already_booked','booking_window_closed'].includes(error.code)) return {...outcome,status:'skipped',reason:error.code};
    throw error;
  }
}
const signature = (outcomes: Outcome[]) => JSON.stringify(outcomes.map(({bookingId,...o}) => o));
function review(tx: Transaction, classes: RecordData[], personId: string) {
  const preview = new Transaction(tx.db,structuredClone(tx.state),tx.who);
  preview.notices = {...tx.notices,queued:[]};
  return classes.map(entry => attempt(preview,entry,personId));
}
export async function prepareReservations(tx: Transaction, input: Record<string,unknown>) {
  const who = member(tx,input), {series,classes,throughDate} = selection(tx.state,input);
  const outcomes = review(tx,classes,who.id).map(({bookingId,...outcome}) => outcome);
  const draft = {id:id(),personId:who.id,status:'preview',operation:'reserve',classId:input.classId,seriesId:series.id,throughDate,timeZone:series.timeZone,outcomes,
    key:id(),basis:await basis(tx.state,tx),channel:staffIdentity(tx.state,tx.who) ? staffChannel(input) : 'online',createdAt:now(),createdBy:tx.who.id};
  tx.put('reservationPreview',draft); return draft;
}
function ownPreview(tx: Transaction, input: Record<string,unknown>, operation: string) {
  const draft = record(tx.state,input.id,'reservationPreview');
  member(tx,{...input,personId:draft.personId});
  insist(draft.operation === operation && input.key === draft.key,'reservation_review_required',409); return draft;
}
export async function confirmReservations(tx: Transaction, input: Record<string,unknown>) {
  const draft = ownPreview(tx,input,'reserve');
  if (draft.status === 'confirmed') return record(tx.state,draft.reservationId,'reservation');
  insist(draft.status === 'preview' && draft.basis === await basis(tx.state,tx),'reservation_facts_changed',409);
  const {classes} = selection(tx.state,draft), checked = review(tx,classes,draft.personId);
  insist(signature(checked) === signature(draft.outcomes),'reservation_facts_changed',409);
  const reservationId = id(), outcomes = classes.map(entry => {
    const outcome = attempt(tx,entry,draft.personId,staffIdentity(tx.state,tx.who) ? staffChannel(input) : 'online');
    if (outcome.bookingId) {
      const booking = {...record(tx.state,outcome.bookingId,'booking'),reservationId};
      tx.put('booking',booking); confirmBooking(tx,booking);
    }
    return outcome;
  });
  const saved = {id:reservationId,personId:draft.personId,seriesId:draft.seriesId,throughDate:draft.throughDate,timeZone:draft.timeZone,outcomes,status:'active',createdAt:now(),createdBy:tx.who.id,staffActionId:staffIdentity(tx.state,tx.who) ? id() : null};
  tx.put('reservation',saved); tx.put('reservationPreview',{...draft,status:'confirmed',reservationId}); return saved;
}
function cancellationOutcomes(state: State, reservation: RecordData) {
  return reservation.outcomes.flatMap((o: RecordData) => {
    const b = o.bookingId ? state.records.get(o.bookingId)?.data : null, entry = b ? state.records.get(b.classId)?.data : null;
    return b && entry && entry.start > now() && !b.checkedInAt && !b.attendance && ['booked','waitlisted','offered'].includes(b.status)
      ? [{id:b.id,classId:entry.id,start:entry.start,status:b.status,effect:cancellationEffect(b,entry)}] : [];
  });
}
export async function prepareReservationCancellation(tx: Transaction, input: Record<string,unknown>) {
  const reservation = record(tx.state,input.reservationId,'reservation'); member(tx,{...input,personId:reservation.personId});
  const outcomes = cancellationOutcomes(tx.state,reservation);
  const draft = {id:id(),personId:reservation.personId,reservationId:reservation.id,status:'preview',operation:'cancel',timeZone:reservation.timeZone,outcomes,key:id(),basis:await basis(tx.state,tx),channel:staffIdentity(tx.state,tx.who) ? staffChannel(input) : 'online',createdAt:now(),createdBy:tx.who.id};
  tx.put('reservationPreview',draft); return draft;
}
export async function confirmReservationCancellation(tx: Transaction, input: Record<string,unknown>) {
  const draft = ownPreview(tx,input,'cancel'), reservation = record(tx.state,draft.reservationId,'reservation');
  if (draft.status === 'confirmed') return reservation;
  const outcomes = cancellationOutcomes(tx.state,reservation);
  insist(draft.basis === await basis(tx.state,tx) && JSON.stringify(outcomes) === JSON.stringify(draft.outcomes),'reservation_facts_changed',409);
  const staffActionId = staffIdentity(tx.state,tx.who) ? id() : undefined;
  for (const o of outcomes) cancel(tx,{...input,id:o.id,terms:o.effect.key,mode:'late'},staffActionId);
  const saved = {...reservation,status:'cancelled',cancelledAt:now(),cancelledBy:tx.who.id,cancelledBookingIds:outcomes.map((o: RecordData) => o.id),cancellationEffects:outcomes,staffActionId:staffActionId ?? null};
  tx.put('reservation',saved); tx.put('reservationPreview',{...draft,status:'confirmed'}); return saved;
}
export function reservationSnapshot(state: State, who: import('./types').Actor) {
  const visible = (kind: string) => list(state,kind).filter(r => who.role === 'owner' || (who.role === 'member' && r.personId === who.personId) || (staffIdentity(state,who) && r.outcomes.length > 0 && r.outcomes.every((o: RecordData) => {const c=state.records.get(o.classId)?.data;return c && classRightVisible(state,who,'booking',r.personId,c);})));
  return {reservations:visible('reservation'),reservationPreviews:visible('reservationPreview')};
}
