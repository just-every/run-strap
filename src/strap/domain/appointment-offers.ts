import { classFields } from './classes';
import { locationById, ORIGINAL_LOCATION } from './locations';
import { schedulingConflicts } from './scheduling';
import { requestBasis } from './staff-actions';
import { humanOwner, instant, integer, insist, list, now, person, record, text, type RecordData } from './types';
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
  const offer = {...entry,localDate,durationMinutes,status:'offered',requestId,requestBasis:basis,createdAt:now(),createdBy:tx.who.id};
  tx.put('appointmentOffer',offer);
  return offer;
}

/** Recompute from current allocations. An available preview is never a booking. */
export function previewAppointmentOffer(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const offer = record(tx.state,input.id,'appointmentOffer'), blockers: RecordData[] = [];
  const instructor = tx.state.people.find(p => p.id === offer.instructorId && p.active && !p.erasedAt && p.role === 'instructor');
  if (!instructor || instructor.version !== offer.instructorVersion) blockers.push({id:offer.instructorId,kind:'instructor_changed'});
  if (offer.start <= now()) blockers.push({id:offer.id,kind:'appointment_started'});
  const conflicts = schedulingConflicts([offer],list(tx.state,'class').filter(c => c.status !== 'cancelled'),list(tx.state,'unavailability'));
  for (const conflict of conflicts) blockers.push({id:conflict.record.id,kind:conflict.recordKind,resource:conflict.resource,
    start:conflict.occupiedStart,end:conflict.occupiedEnd,...(conflict.recordKind === 'unavailability' ? {reason:conflict.record.reason} : {})});
  for (const closure of list(tx.state,'closure').filter(c => c.status === 'applied' && c.scope === 'location' &&
    (c.locationId ?? ORIGINAL_LOCATION) === offer.locationId && offer.start < c.end && offer.end > c.start)) {
    blockers.push({id:closure.id,kind:'location_closed',start:closure.start,end:closure.end,reason:closure.reason});
  }
  return {id:offer.id,offer,available:blockers.length === 0,blockers,asOf:now(),reserved:false,
    paymentCollected:false,bookingAvailable:false};
}
