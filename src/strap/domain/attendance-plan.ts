import { legacyStaffGrant } from './staff-rights';
import { attendanceBookingVisible, requireAttendanceBooking } from './attendance-access';
import { acknowledged, book, bookingPack } from './bookings';
import { windowOpen } from './booking-policy';
import { seatCapacity } from './spots';
import { intakeMissing } from './intake';
import { humanOwner, id, insist, instant, list, now, person, preparer, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';

const preference = (state: State, personId: string) => list(state,'attendanceAvailability').find(p=>p.personId===personId);
export function saveAttendanceAvailability(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role==='member' && tx.who.personId,'member_required',403);
  const member=person(tx.state,tx.who.personId), previous=preference(tx.state,member.id);
  insist(input.version===(previous?.version ?? 0),'availability_changed',409);
  insist(Array.isArray(input.windows) && input.windows.length<=28,'invalid_availability');
  const windows=input.windows.map((value: any)=>{
    const start=instant(value?.start,'availability_start'),end=instant(value?.end,'availability_end');
    insist(start<end && Date.parse(end)-Date.parse(start)<=86400000,'invalid_availability_window');return {start,end};
  }).sort((a,b)=>a.start.localeCompare(b.start));
  insist(Array.isArray(input.locationIds) && input.locationIds.length<=100,'invalid_locations');
  const locationIds=[...new Set(input.locationIds.map(value=>text(value,'location_id',100)))];
  for(const locationId of locationIds) insist(locationId==='studio'||list(tx.state,'location').some(l=>l.id===locationId),'location_not_found',404);
  const saved={id:previous?.id ?? id(),personId:member.id,windows,locationIds,version:(previous?.version ?? 0)+1,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('attendanceAvailability',saved);return saved;
}
function feasible(state: State, personId: string, entry: RecordData) {
  const available=preference(state,personId),pack=bookingPack(state,personId,entry);
  return state.people.some(p=>p.id===personId&&p.active&&!p.erasedAt) && !!available && available.windows.some((w: any)=>entry.start>=w.start&&entry.end<=w.end)
    && available.locationIds.includes(entry.locationId ?? 'studio') && !entry.privatePersonId
    && entry.status==='published' && entry.start>now() && acknowledged(state,personId,entry)
    && !intakeMissing(state,personId,[entry.service ?? entry.title]).length
    && !!pack && windowOpen(state,entry,pack) && seatCapacity(state,entry).onlineOpen>0
    && !list(state,'booking').some(b=>b.personId===personId&&b.status!=='cancelled'&&
      (b.classId===entry.id || (b.status==='booked' && (()=>{const c=state.records.get(b.classId)?.data;return c&&c.start<entry.end&&c.end>entry.start;})())));
}
export function prepareAttendancePlan(tx: Transaction, input: Record<string,unknown>) {
  if(tx.who.role!=='front-desk') preparer(tx.who);
  const member=person(tx.state,input.personId),available=preference(tx.state,member.id);
  insist(member.role==='member' && available,'member_availability_required',409);
  if(tx.who.role==='front-desk') {const allowed=available.locationIds.filter((locationId: string)=>attendanceBookingVisible(tx.state,tx.who,member.id,locationId));requireAttendanceBooking(tx,member.id,allowed);}
  const choices=list(tx.state,'class').filter(c=>feasible(tx.state,member.id,c)&&(tx.who.role!=='front-desk'||attendanceBookingVisible(tx.state,tx.who,member.id,c.locationId ?? 'studio'))).sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id)).slice(0,10)
    .map(c=>({classId:c.id,title:c.title,service:c.service ?? c.title,start:c.start,end:c.end,locationId:c.locationId ?? 'studio',packId:bookingPack(tx.state,member.id,c)!.id}));
  const offer={id:id(),personId:member.id,availabilityVersion:available.version,choices,visits:list(tx.state,'booking').filter(b=>b.personId===member.id&&b.attendance==='attended'&&(tx.who.role!=='front-desk'||attendanceBookingVisible(tx.state,tx.who,member.id,tx.state.records.get(b.classId)?.data.locationId ?? 'studio'))).map(b=>b.id),createdAt:now(),createdBy:tx.who.id,status:'offered'};
  tx.put('attendancePlan',offer);return offer;
}
export function acceptAttendancePlan(tx: Transaction, input: Record<string,unknown>) {
  const offer=record(tx.state,input.id,'attendancePlan');
  if(tx.who.role==='member') insist(offer.personId===tx.who.personId,'attendancePlan_not_found',404);else requireAttendanceBooking(tx,offer.personId,[record(tx.state,input.classId,'class').locationId ?? 'studio']);
  const classId=text(input.classId,'classId',100);
  if(offer.status==='accepted') {insist(offer.classId===classId,'attendance_plan_closed',409);return record(tx.state,offer.bookingId,'booking');}
  insist(offer.choices.some((c: any)=>c.classId===classId),'class_not_offered',409);
  insist(preference(tx.state,offer.personId)?.version===offer.availabilityVersion,'availability_changed',409);
  const entry=record(tx.state,classId,'class');
  insist(feasible(tx.state,offer.personId,entry),'attendance_choice_unavailable',409);
  const chosen=offer.choices.find((c: any)=>c.classId===classId);
  insist(['title','start','end'].every(key=>chosen[key]===entry[key]) && chosen.locationId===(entry.locationId ?? 'studio') && chosen.service===(entry.service ?? entry.title),'attendance_choice_changed',409);
  const booking=book(tx,{classId},tx.who.role!=='member' ? offer.personId : undefined);
  insist(booking.status==='booked','attendance_choice_unavailable',409);
  tx.put('attendancePlan',{...offer,status:'accepted',classId,bookingId:booking.id,acceptedAt:now(),acceptedBy:tx.who.id});return booking;
}
export function attendancePlanSnapshot(state: State, who: Actor) {
  const permitted=(personId: string,locationId: string)=>attendanceBookingVisible(state,who,personId,locationId);
  const visible=(r: RecordData)=>who.role==='owner'||who.role==='member'&&r.personId===who.personId
    ||who.role==='front-desk'&&preference(state,r.personId)?.locationIds.some((locationId: string)=>permitted(r.personId,locationId));
  const availability=list(state,'attendanceAvailability').filter(visible).map(r=>who.role==='front-desk'?{...r,locationIds:r.locationIds.filter((locationId: string)=>permitted(r.personId,locationId))}:r);
  const offers=list(state,'attendancePlan').filter(visible).map(offer=>({...offer,
    visits:who.role==='front-desk'?offer.visits.filter((bookingId: string)=>{const booking=state.records.get(bookingId)?.data;return booking&&permitted(offer.personId,state.records.get(booking.classId)?.data.locationId ?? 'studio');}):offer.visits,
    choices:offer.choices.filter((choice: any)=>who.role!=='front-desk'||permitted(offer.personId,choice.locationId)).map((choice: any)=>({...choice,feasible:!!state.records.get(choice.classId)&&feasible(state,offer.personId,state.records.get(choice.classId)!.data)}))}));
  return {availability,offers};
}

/** Staff starts the member-owned preference step without inventing availability. */
export function launchAttendanceAvailability(tx: Transaction, input: Record<string,unknown>) {
  const member=person(tx.state,input.personId);if(tx.who.role==='front-desk'){const g=legacyStaffGrant(tx.state,tx.who,'attendance-plan');requireAttendanceBooking(tx,member.id,g?.locationIds ?? []);}else humanOwner(tx.who);
  return {id:member.id,personId:member.id,status:'member_action_required',path:'/app#attendance-plan'};
}
export function acceptAttendancePlanForMember(tx: Transaction, input: Record<string,unknown>) {
  if(tx.who.role!=='front-desk')humanOwner(tx.who);return acceptAttendancePlan(tx,input);
}
