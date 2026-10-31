import { catalogCheckoutSnapshot } from './catalog-checkout';
import { freezeStaffVisible } from './freezes';
import { terminationReasons } from './termination-reasons';
import { cancellationPreviewStale, cancellationStaffVisible, cancellationWithdrawals, mayWithdrawCancellation } from './contract-cancellations';
import { locations } from './locations';
import { memberRecordVisible } from './member-records';
import { classRightVisible } from './staff-command-access';
import { staffAccess, hasStaffRight } from './staff-rights';
import { list, type Actor, type State } from './types';
import { cancellationEffect } from './booking-policy';
import { seatCapacity } from './spots';
import { packSummary } from './pack-credits';

/** Operational staff receive no ledger, payer, private conflict reason or pay data. */
export async function staffDeskSnapshot(state: State, who: Actor) {
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
  return {...catalogCheckoutSnapshot(state,who),freezePacks:list(state,'pack').filter(p=>freezeStaffVisible(state,who,p.id)).map(p=>({id:p.id,personId:p.personId,credits:p.credits,remaining:p.remaining,expiresAt:p.expiresAt,entitlement:p.entitlement})),collectionLocations:locations(state).filter(l=>hasStaffRight(state,who,'collection',undefined,l.id)).map(l=>({id:l.id,name:l.name})),staffRecurring:list(state,'recurringTerms').filter(t => rightForPack('membership-sale',t.packId) || rightForPack('contract-change',t.packId)),staffTerminationContracts:list(state,'recurringTerms').filter(t=>t.acceptedAt&&t.currentPackId&&cancellationStaffVisible(state,who,t.currentPackId)).map(t=>({id:t.id,packId:t.currentPackId,personId:t.personId})),terminationReasonCodes:hasStaffRight(state,who,'contract-change')?terminationReasons(state).filter(r=>r.active):[],staffContracts:await Promise.all(list(state,'contractCancellation').filter(c => cancellationStaffVisible(state,who,c.packId)).map(async c=>({...c,canWithdraw:mayWithdrawCancellation(state,who,c)&&c.status==='scheduled'&&c.effectiveAt>new Date().toISOString(),stale:await cancellationPreviewStale(state,c)}))),staffCancellationWithdrawals:await cancellationWithdrawals(state,who),classes:classes.map(c => ({...c,occupancy:seatCapacity(state,c)})),bookings,packs,
    cancellationReasons:state.records.get('cancellation-reasons')?.data.reasons ?? ['Sick','Schedule conflict','Other'],
    staffPermissions:access?.enabled ? Object.keys(access.rights).filter(right => access.rights[right as keyof typeof access.rights]?.enabled) : []};
}
