import { authorizeCancellationCommand } from './contract-cancellations';
import { authorizeCourse } from './courses';
import { authorizeFreezeCommand } from './freezes';
import { hasStaffRight, requireStaffRight, staffAccess, type StaffRight } from './staff-rights';
import { insist, record, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';

const delegated = new Map<string,StaffRight>([
  ...['course.enrollment.prepare','course.enrollment.launch','course.enrollment.confirm'].map(name=>[name,'sale'] as [string,StaffRight]),
  ...['course.withdraw.prepare','course.withdraw.confirm'].map(name=>[name,'contract-change'] as [string,StaffRight]),
  ...['booking.desk','booking.cancel','booking.move','booking.restore','booking.spot.staff','booking.offer.accept.staff','reservation.prepare','reservation.confirm','reservation.cancel.prepare','reservation.cancel.confirm'].map(name => [name,'booking'] as [string,StaffRight]),
  ['booking.waitlist.position','override'],
  ['attendance.checkin','check-in'],
  ['plan.recurring.prepare','membership-sale'],
  ...['plan.cancellation.prepare','plan.cancellation.confirm','plan.cancellation.withdraw.prepare','plan.cancellation.withdraw.confirm'].map(name=>[name,'contract-change'] as [string,StaffRight]),
  ...['freeze.prepare','freeze.confirm','freeze.accept.launch','freeze.end.prepare','freeze.end.confirm','freeze.end.accept.launch','freeze.decline','freeze.request.withdraw','freeze.withdraw'].map(name=>[name,'contract-change'] as [string,StaffRight]),
]);
export const delegatedCommandRight = (name: string) => delegated.get(name);
export const staffIdentity = (state: State, who: Actor) => who.role === 'owner' && who.isOwner || !!staffAccess(state,who)?.enabled;

export function requireClassRight(tx: Transaction, right: StaffRight, personId: string, entry: RecordData) {
  requireStaffRight(tx.state,tx.who,right,personId,entry.locationId ?? 'studio','class');
  if (tx.who.role === 'instructor') insist(entry.instructorId === tx.who.personId,'assigned_instructor_required',403);
}

/** Resolve saved targets before replay; a request body cannot substitute its own scope. */
export function authorizeStaffCommand(tx: Transaction, name: string, input: Record<string,unknown>, right: StaffRight) {
  if(name.startsWith('plan.cancellation.'))return authorizeCancellationCommand(tx,name,input);
  if(name.startsWith('course.'))return authorizeCourse(tx,name,input);
  if(name.startsWith('freeze.'))return authorizeFreezeCommand(tx,name,input);
  requireStaffRight(tx.state,tx.who,right);
  const target = input.id ? tx.state.records.get(String(input.id)) : null;
  const reservation = input.reservationId ? tx.state.records.get(String(input.reservationId))?.data : null;
  const pack = input.packId ? record(tx.state,input.packId,'pack') : target?.data.packId ? record(tx.state,target.data.packId,'pack') : null;
  const personId = String(target?.data.personId ?? reservation?.personId ?? pack?.personId ?? input.personId ?? '');
  const classId = target?.kind === 'booking' ? target.data.classId : input.classId;
  if (name.startsWith('reservation.')) {
    const source = target?.data ?? reservation;
    const classes = source?.outcomes?.map((o: RecordData) => tx.state.records.get(o.classId)?.data).filter(Boolean)
      ?? [record(tx.state,input.classId,'class')];
    insist(classes.length > 0,'staff_scope_required',403);
    for (const entry of classes) requireClassRight(tx,right,personId,entry);
  } else if (classId) {
    const entry = record(tx.state,classId,'class');
    requireClassRight(tx,right,personId,entry);
    if (input.classId && input.classId !== classId) requireClassRight(tx,right,personId,record(tx.state,input.classId,'class'));
    if (input.override) requireClassRight(tx,'override',personId,record(tx.state,input.classId ?? classId,'class'));
  } else {
    insist(personId.length > 0,'staff_scope_required',403);
    requireStaffRight(tx.state,tx.who,right,personId,pack?.locationId ?? 'studio');
  }
}

export function classRightVisible(state: State, who: Actor, right: StaffRight, personId: string, entry: RecordData) {
  return hasStaffRight(state,who,right,personId,entry.locationId ?? 'studio','class')
    && (who.role !== 'instructor' || entry.instructorId === who.personId);
}
