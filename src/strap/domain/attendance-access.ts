import { locationById } from './locations';
import { memberRecordGrant, requireMemberRecord } from './member-records';
import type { Transaction } from './store';
import { humanOwner, id, insist, now, person, type Actor, type State } from './types';

export function attendanceBookingGrant(state: State, who: Actor) {
  const row = who.personId ? state.records.get(`attendance-booking-grant:${who.personId}`) : undefined;
  return row?.kind === 'attendanceBookingGrant' && row.data.personId === who.personId ? row.data : null;
}

/** Booking scope grants no access to other offers, payments or other financial records. */
export function attendanceBookingVisible(state: State, who: Actor, personId: string, locationId: string): boolean {
  if (who.role === 'owner' && who.isOwner) return true;
  const grant = attendanceBookingGrant(state,who), memberGrant = memberRecordGrant(state,who);
  const staff = state.people.find(p => p.id === who.personId && p.active && !p.erasedAt && p.role === 'member');
  return who.role === 'front-desk' && !!staff && grant?.enabled === true && memberGrant?.enabled === true
    && memberGrant.personId === who.personId
    && state.records.get(`member-record-grant:${who.personId}`)?.kind === 'memberRecordGrant'
    && Array.isArray(memberGrant.memberIds) && memberGrant.memberIds.includes(personId)
    && Array.isArray(grant.memberIds) && grant.memberIds.includes(personId)
    && Array.isArray(grant.locationIds) && grant.locationIds.includes(locationId);
}

export function requireAttendanceBooking(tx: Transaction, personId: string, locationIds: string[]) {
  if (tx.who.role === 'owner' && tx.who.isOwner) {
    humanOwner(tx.who);
    return;
  }
  // Resolve both grants from current transaction state on every operation, including revocation.
  insist(typeof personId === 'string' && personId.length > 0 && Array.isArray(locationIds) && locationIds.length > 0
    && locationIds.every(locationId => typeof locationId === 'string'
      && attendanceBookingVisible(tx.state,tx.who,personId,locationId)),
  'attendance_booking_right_required',403);
  requireMemberRecord(tx.state,tx.who,personId);
}

export async function grantAttendanceBooking(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const staff = person(tx.state,input.personId);
  insist(staff.role === 'member' && staff.email,'member_staff_identity_required');
  insist(!await tx.db.prepare("SELECT 1 FROM oa_operators WHERE lower(email)=lower(?) AND role='owner'")
    .bind(staff.email).first(),'owner_identity_cannot_be_front_desk',409);
  const memberGrant = tx.state.records.get(`member-record-grant:${staff.id}`);
  insist(memberGrant?.kind === 'memberRecordGrant' && memberGrant.data.personId === staff.id
    && memberGrant.data.enabled === true,'member_record_right_required',403);
  insist(typeof input.enabled === 'boolean','invalid_attendance_booking_grant');
  insist(Array.isArray(input.memberIds) && input.memberIds.length <= 500,'invalid_member_scope');
  insist(Array.isArray(input.locationIds) && input.locationIds.length <= 100,'invalid_location_scope');
  const memberIds = [...new Set(input.memberIds.map(value => {
    const member = person(tx.state,value,false);
    insist(member.role === 'member','member_required');
    return member.id;
  }))].sort();
  const locationIds = [...new Set(input.locationIds.map(value => locationById(tx.state,value).id))].sort();
  insist(!input.enabled || memberIds.length > 0,'invalid_member_scope');
  insist(!input.enabled || locationIds.length > 0,'invalid_location_scope');
  const key = `attendance-booking-grant:${staff.id}`, prior = tx.state.records.get(key)?.data;
  const saved = {id:key,personId:staff.id,enabled:input.enabled,memberIds,locationIds,
    version:(prior?.version ?? 0)+1,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('attendanceBookingGrant',saved);
  tx.put('attendanceBookingGrantEvent',{id:id(),personId:staff.id,before:prior ?? null,after:saved,
    at:saved.updatedAt,actorId:tx.who.id});
  return saved;
}
