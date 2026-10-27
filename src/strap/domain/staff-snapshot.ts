import { locations } from './locations';
import { memberRecordVisible } from './member-records';
import { classRightVisible } from './staff-command-access';
import { staffAccess, hasStaffRight } from './staff-rights';
import { list, type Actor, type State } from './types';
import { cancellationEffect } from './booking-policy';
import { seatCapacity } from './spots';
import { packSummary } from './pack-credits';

/** Operational staff receive no ledger, payer, private conflict reason or pay data. */
export function staffDeskSnapshot(state: State, who: Actor) {
  const access = staffAccess(state,who);
  const members = state.people.filter(p => p.role === 'member' && !p.erasedAt && memberRecordVisible(state,who,p.id));
  const classes = list(state,'class').filter(c => !c.privatePersonId && members.some(p =>
    classRightVisible(state,who,'booking',p.id,c) || classRightVisible(state,who,'check-in',p.id,c)));
  const classIds = new Set(classes.map(c => c.id));
  const bookings = list(state,'booking').filter(b => classIds.has(b.classId) && members.some(p => p.id === b.personId)
    && (classRightVisible(state,who,'booking',b.personId,state.records.get(b.classId)!.data) || classRightVisible(state,who,'check-in',b.personId,state.records.get(b.classId)!.data)))
    .map(b => ({id:b.id,personId:b.personId,classId:b.classId,status:b.status,packId:b.packId,attendance:b.attendance,checkedInAt:b.checkedInAt,cancellation:b.cancellation,refunded:b.refunded,
      ...(state.records.get(b.classId)!.data.start > new Date().toISOString() && b.status !== 'cancelled' ? {cancelEffect:cancellationEffect(b,state.records.get(b.classId)!.data)} : {})}));
  const packs = list(state,'pack').filter(p => members.some(m => m.id === p.personId) && memberRecordVisible(state,who,p.personId,p.locationId ?? 'studio')).map(p => ({id:p.id,personId:p.personId,credits:p.credits,remaining:p.remaining,expiresAt:p.expiresAt,eligibleServices:p.eligibleServices,entitlement:p.entitlement,summary:packSummary(state,p)}));
  const rightForPack=(right: 'membership-sale'|'contract-change',packId: string) => {const p=state.records.get(packId)?.data;return p && hasStaffRight(state,who,right,p.personId,p.locationId ?? 'studio');};
  return {collectionLocations:locations(state).filter(l=>hasStaffRight(state,who,'collection',undefined,l.id)).map(l=>({id:l.id,name:l.name})),staffRecurring:list(state,'recurringTerms').filter(t => rightForPack('membership-sale',t.packId) || rightForPack('contract-change',t.packId)),staffContracts:list(state,'contractCancellation').filter(c => rightForPack('contract-change',c.packId)),classes:classes.map(c => ({...c,occupancy:seatCapacity(state,c)})),bookings,packs,
    cancellationReasons:state.records.get('cancellation-reasons')?.data.reasons ?? ['Sick','Schedule conflict','Other'],
    staffPermissions:access?.enabled ? Object.keys(access.rights).filter(right => access.rights[right as keyof typeof access.rights]?.enabled) : []};
}
