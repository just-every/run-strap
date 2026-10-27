import { addDays, localDate } from '../zone';
import { recurrence, wallStart } from './series-model';
import { classFields } from './classes';
import { locationById, ORIGINAL_LOCATION } from './locations';
import { resourceLabel, schedulingConflicts } from './scheduling';
import { requestBasis } from './staff-actions';
import { humanOwner, id, instant, integer, insist, list, now, person, record, text, DomainError, type RecordData } from './types';
import type { Transaction } from './store';

/** Offers describe alternatives, never reserve resources or authorize a payment. */
export function saveAppointmentOffer(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const requestId = text(input.requestId,'requestId',100), basis = requestBasis(input);
  const prior = list(tx.state,'appointmentOffer').find(o => o.createdBy === tx.who.id && o.requestId === requestId);
  if (prior) {
    insist(prior.requestBasis === basis,'appointment_offer_request_changed',409);
    return prior;
  }
  insist(input.id === undefined,'appointment_offer_immutable',409);
  const fields = appointmentFields(tx,input);
  const offer = {...fields,status:'offered',requestId,requestBasis:basis,createdAt:now(),createdBy:tx.who.id,availabilityAtCreation:appointmentAvailability(tx,fields)};
  tx.put('appointmentOffer',offer);
  return offer;
}

function appointmentFields(tx: Transaction, input: Record<string,unknown>) {
  const service = text(input.service,'service',160), start = instant(input.start,'start');
  const durationMinutes = integer(input.durationMinutes,'duration_minutes',5,600);
  const location = locationById(tx.state,input.locationId ?? ORIGINAL_LOCATION);
  const entry = classFields(tx,{...input,title:service,service,start,
    end:new Date(Date.parse(start)+durationMinutes*60_000).toISOString(),capacity:1,onlineCapacity:1,locationId:location.id});
  const instructor = person(tx.state,entry.instructorId);
  insist(instructor.role === 'instructor','instructor_required');
  insist(entry.room,'appointment_room_required');
  insist(start > now(),'appointment_must_be_future',409);
  tx.future(start);
  const localDate = new Intl.DateTimeFormat('en-CA',{timeZone:location.timeZone}).format(new Date(start));
  return {...entry,localDate,durationMinutes};
}

/** Recompute from current allocations. An available preview is never a booking. */
export function previewAppointmentOffer(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const offer = record(tx.state,input.id,'appointmentOffer');
  return {id:offer.id,offer,...appointmentAvailability(tx,offer)};
}

export function appointmentAvailability(tx: Transaction, offer: RecordData, siblings: RecordData[] = []) {
  const blockers: RecordData[] = [];
  const instructor = tx.state.people.find(p => p.id === offer.instructorId && p.active && !p.erasedAt && p.role === 'instructor');
  if (!instructor || instructor.version !== offer.instructorVersion) blockers.push({id:offer.instructorId,kind:'instructor_changed'});
  if (offer.start <= now()) blockers.push({id:offer.id,kind:'appointment_started'});
  const conflicts = schedulingConflicts([offer],[...list(tx.state,'class').filter(c => c.status !== 'cancelled'),...siblings.filter(c => c.id !== offer.id)],list(tx.state,'unavailability'));
  for (const conflict of conflicts) blockers.push({id:conflict.record.id,kind:conflict.recordKind,resource:conflict.resource,
    start:conflict.occupiedStart,end:conflict.occupiedEnd,reason:conflict.recordKind === 'unavailability' ? conflict.record.reason : (siblings.some(c => c.id === conflict.record.id) ? 'Proposed series occurrence: ' : 'Published class: ')+conflict.record.title});
  for (const closure of list(tx.state,'closure').filter(c => c.status === 'applied' && ['location','room'].includes(c.scope) &&
    (c.scope === 'location' || resourceLabel(c.room).toLowerCase() === resourceLabel(offer.room).toLowerCase()) &&
    (c.locationId ?? ORIGINAL_LOCATION) === offer.locationId && offer.start < c.end && offer.end > c.start)) {
    blockers.push({id:closure.id,kind:closure.scope === 'room' ? 'room_closed' : 'location_closed',start:closure.start,end:closure.end,reason:closure.reason});
  }
  return {available:blockers.length === 0,blockers,asOf:now(),reserved:false,
    paymentCollected:false,bookingAvailable:false};
}

/** Owner-only recurring alternatives use the same private, nonbinding offer policy. */
export function saveAppointmentSeriesOffer(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const requestId = text(input.requestId,'requestId',100), basis = requestBasis(input);
  const prior = list(tx.state,'appointmentSeriesOffer').find(o => o.createdBy === tx.who.id && o.requestId === requestId);
  if (prior) {
    insist(prior.requestBasis === basis,'appointment_offer_request_changed',409);
    return prior;
  }
  insist(input.id === undefined,'appointment_offer_immutable',409);
  const {rule,occurrences:checkedOccurrences} = appointmentSeriesFields(tx,input);
  const offer = {id:id(),rule,occurrences:checkedOccurrences,requestId,requestBasis:basis,status:'offered',createdAt:now(),createdBy:tx.who.id,
    reserved:false,bookingAvailable:false,paymentCollected:false};
  tx.put('appointmentSeriesOffer',offer);
  return offer;
}

export function previewAppointmentSeriesOffer(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const offer = record(tx.state,input.id,'appointmentSeriesOffer');
  const occurrences = offer.occurrences.map((entry: RecordData) => {
    if (entry.status === 'skipped') return {...entry,available:true,blockers:[],alternatives:[],reserved:false,paymentCollected:false,bookingAvailable:false};
    const live = offer.occurrences.filter((o: RecordData)=>o.status !== 'skipped');
    const checked = appointmentAvailability(tx,entry,live), alternatives: RecordData[] = [];
    if (!checked.available) for (let day = 1; day <= Math.min(6,offer.rule.intervalWeeks*7-1); day++) {
      const date = addDays(entry.occurrenceDate,day);
      let start: string;
      try { start = instant(wallStart(date,offer.rule.time,offer.rule.timeZone),'start'); }
      catch (error) {
        if (error instanceof DomainError && error.code === 'local_time_does_not_exist') continue;
        throw error;
      }
      const candidate = {...entry,start,end:new Date(Date.parse(start)+offer.rule.minutes*60_000).toISOString(),localDate:date};
      if (appointmentAvailability(tx,candidate,live).available) alternatives.push(candidate);
    }
    return {...entry,...checked,alternatives};
  });
  return {id:offer.id,offer,occurrences,available:occurrences.every((o: RecordData) => o.available),
    reserved:false,paymentCollected:false,bookingAvailable:false};
}

/** Shared normalization for the separate explicit desk reservation preview. */
export function appointmentSeriesFields(tx: Transaction,input: Record<string,unknown>) {
  const rule = recurrence(tx.state,input);
  const choices = input.choices ?? [];
  insist(Array.isArray(choices) && choices.length <= rule.dates.length,'invalid_appointment_choices');
  const byDate = new Map<string,{date:string;start?:string;skip?:true;reason?:string}>();
  for (const raw of choices) {
    insist(raw && typeof raw === 'object' && !Array.isArray(raw),'invalid_appointment_choice');
    const date = text(raw.date,'date',10);
    insist(rule.dates.includes(date) && !byDate.has(date),'invalid_appointment_choice');
    if (raw.skip === true) {
      insist(raw.start === undefined,'invalid_appointment_choice');
      byDate.set(date,{date,skip:true,reason:text(raw.reason,'skip_reason',500)});
      continue;
    }
    insist(raw.skip === undefined,'invalid_appointment_choice');
    const start = instant(raw.start,'start');
    const chosenDate = localDate(start,rule.timeZone);
    insist(chosenDate >= date && chosenDate < addDays(date,rule.intervalWeeks*7),'choice_outside_occurrence');
    byDate.set(date,{date,start});
  }
  const occurrences = rule.dates.map(date => {
    const originalStart = instant(wallStart(date,rule.time,rule.timeZone),'start'), choice = byDate.get(date);
    const offer = appointmentFields(tx,{...input,start:choice?.start ?? originalStart,durationMinutes:rule.minutes});
    return {...offer,occurrenceDate:date,originalStart,chosenAlternative:!!choice && !choice.skip,
      ...(choice?.skip ? {status:'skipped',reason:choice.reason} : {})};
  });
  const checkedOccurrences = occurrences.map(entry => {
    const checked = entry.status === 'skipped' ? {available:true,blockers:[],reserved:false,paymentCollected:false,bookingAvailable:false}
      : appointmentAvailability(tx,entry,occurrences.filter(o=>o.status !== 'skipped'));
    if (entry.chosenAlternative) insist(checked.available,'appointment_choice_unavailable',409);
    return {...entry,availabilityAtCreation:checked};
  });
  return {rule,occurrences:checkedOccurrences};
}
