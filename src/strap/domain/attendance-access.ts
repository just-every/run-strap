import { memberRecordVisible, requireMemberRecord } from './member-records';
import { hasStaffRight, legacyStaffGrant, staffIdentity, staffLocationIds, staffMemberIds, updateLegacyStaffAccess } from './staff-rights';
import type { Transaction } from './store';
import { humanOwner, insist, type Actor, type State } from './types';

export function attendanceBookingGrant(state: State, who: Actor) {
  return legacyStaffGrant(state,who,'attendance-plan');
}

export function attendanceBookingVisible(state: State, who: Actor, personId: string, locationId: string, instructorId?: string): boolean {
  if (who.role === 'owner' && who.isOwner) return true;
  if (!['manager','front-desk','instructor'].includes(who.role)) return false;
  if (who.role === 'instructor' && instructorId !== who.personId) return false;
  return hasStaffRight(state,who,'booking',personId,locationId,'attendance-plan')
    && memberRecordVisible(state,who,personId,locationId);
}

export function requireAttendanceBooking(tx: Transaction, personId: string, locationIds: string[], instructorId?: string) {
  if (tx.who.role === 'owner' && tx.who.isOwner) { humanOwner(tx.who); return; }
  insist(typeof personId === 'string' && personId.length > 0 && Array.isArray(locationIds) && locationIds.length > 0
    && locationIds.every(locationId => typeof locationId === 'string'
      && attendanceBookingVisible(tx.state,tx.who,personId,locationId,instructorId)),
    'attendance_booking_right_required',403);
  requireMemberRecord(tx.state,tx.who,personId);
}

export async function grantAttendanceBooking(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const staff = await staffIdentity(tx,input.personId,'front-desk');
  const memberGrant = legacyStaffGrant(tx.state,{personId:staff.id},'member-record');
  insist(memberGrant?.enabled === true,'member_record_right_required',403);
  insist(typeof input.enabled === 'boolean','invalid_attendance_booking_grant');
  const memberIds = staffMemberIds(tx.state,input.memberIds), locationIds = staffLocationIds(tx.state,input.locationIds);
  insist(!input.enabled || memberIds.length > 0,'invalid_member_scope');
  insist(!input.enabled || locationIds.length > 0,'invalid_location_scope');
  return updateLegacyStaffAccess(tx,'attendance-plan',{id:`attendance-booking-grant:${staff.id}`,personId:staff.id,enabled:input.enabled,memberIds,locationIds});
}
