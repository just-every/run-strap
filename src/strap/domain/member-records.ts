import { ledgerLocation } from '../location-scope';
import { extendStaffMemberScope, hasStaffRight, staffAccess, legacyStaffGrant, staffIdentity, staffMemberIds, updateLegacyStaffAccess } from './staff-rights';
import { visiblePreferences } from './preferences';
import { humanOwner, id, insist, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { profileOf, saveMemberProfile } from './profiles';
import { saveDeskPerson } from './people';
import { staffChannel } from './staff-actions';

export function memberRecordGrant(state: State, who: Actor) {
  return legacyStaffGrant(state,who,'member-record');
}
export function memberRecordVisible(state: State, who: Actor, personId?: unknown, locationId?: unknown) {
  return hasStaffRight(state,who,'member-record',personId,locationId)
    || hasStaffRight(state,who,'member-record',personId,undefined,'member-record')
      && !!staffAccess(state,who)?.rights['member-record']?.scopes.some(scope => scope.doors.includes('member-record')
        && (personId === undefined || scope.memberIds.includes(personId as string)));
}
export function requireMemberRecord(state: State, who: Actor, personId?: unknown, locationId?: unknown) {
  insist(memberRecordVisible(state,who,personId,locationId),'member_record_right_required',403);
}
export async function grantMemberRecord(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);
  const staff = await staffIdentity(tx,input.personId,'front-desk');
  insist(typeof input.enabled === 'boolean' && typeof input.canCreate === 'boolean','invalid_staff_grant');
  const memberIds = staffMemberIds(tx.state,input.memberIds);
  tx.sql.push(tx.statement('UPDATE oa_operators SET version=version+1 WHERE lower(email)=lower(?)',staff.email));
  return updateLegacyStaffAccess(tx,'member-record',{id:`member-record-grant:${staff.id}`,personId:staff.id,enabled:input.enabled,canCreate:input.canCreate,memberIds});
}
export async function createDeskMember(tx: Transaction,input: Record<string,unknown>) {
  requireMemberRecord(tx.state,tx.who);
  if (tx.who.role !== 'owner') insist(memberRecordGrant(tx.state,tx.who)?.canCreate,'member_record_create_right_required',403);
  insist(!input.id && (input.role === undefined || input.role === 'member') && input.active !== false,'desk_member_creation_only',403);
  const result = await saveDeskPerson(tx,{...input,role:'member',active:true});
  if (tx.who.role !== 'owner') extendStaffMemberScope(tx,result.id);
  return {...result,personId:result.id};
}
export function addMemberNote(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who); const member = person(tx.state,input.personId,false);
  insist(member.role === 'member','member_required');
  insist(typeof input.alert === 'boolean','invalid_alert');
  const note = {id:id(),personId:member.id,text:text(input.text,'note',2000),alert:input.alert,at:now(),actorId:tx.who.id,channel:staffChannel(input)};
  tx.put('memberNote',note); return note;
}
export const linkedMemberIds = (state: State, personId: string) => {
  const parent = list(state,'memberMerge').find(m => m.sourceId === personId)?.targetId ?? personId;
  return [parent,...list(state,'memberMerge').filter(m => m.targetId === parent).map(m => m.sourceId)];
};
function mergeFacts(state: State,sourceId: string,targetId: string) {
  return JSON.stringify({source:person(state,sourceId,false),target:person(state,targetId,false),records:[...state.records].filter(([,r]) => ['pack','booking','charge','payment','memberPreference','memberNote'].includes(r.kind) && [sourceId,targetId].includes(r.data.personId))});
}
export function prepareMemberMerge(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);
  const source = person(tx.state,input.sourceId,false), target = person(tx.state,input.targetId,false);
  insist(source.id !== target.id && source.role === 'member' && target.role === 'member','two_distinct_members_required');
  insist(!list(tx.state,'memberMerge').some(m => [m.sourceId,m.targetId].includes(source.id) || m.sourceId === target.id),'merge_identity_already_linked',409);
  const preview = {id:id(),sourceId:source.id,targetId:target.id,personId:target.id,status:'preview',reason:text(input.reason,'reason',500),
    source:profileOf(tx.state,source),target:profileOf(tx.state,target),sourceSummary:memberHistory(tx.state,tx.who,source.id),targetSummary:memberHistory(tx.state,tx.who,target.id),
    // State version changes when this preview is saved; all later changes invalidate confirmation.
    version:tx.state.version+1,basis:mergeFacts(tx.state,source.id,target.id),createdAt:now(),createdBy:tx.who.id};
  const saved = {...preview,key:id()}; tx.put('memberMergePreview',saved); return saved;
}
export function confirmMemberMerge(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who); const preview = record(tx.state,input.id,'memberMergePreview');
  insist(preview.createdBy === tx.who.id && input.key === preview.key,'merge_preview_changed',409);
  const prior = list(tx.state,'memberMerge').find(m => m.previewId === preview.id); if (prior) return prior;
  insist(tx.state.version === preview.version,'merge_source_changed',409);
  insist(mergeFacts(tx.state,preview.sourceId,preview.targetId) === preview.basis,'merge_source_changed',409);
  const source = person(tx.state,preview.sourceId,false), target = person(tx.state,preview.targetId,false);
  insist(!list(tx.state,'memberMerge').some(m => [m.sourceId,m.targetId].includes(source.id) || m.sourceId === target.id),'merge_identity_already_linked',409);
  const merged = {id:id(),personId:target.id,sourceId:source.id,targetId:target.id,sourceIdentity:profileOf(tx.state,source),targetIdentity:profileOf(tx.state,target),
    previewId:preview.id,reason:preview.reason,at:now(),actorId:tx.who.id,channel:staffChannel(input),authorityTransferred:false};
  tx.put('memberMerge',merged); tx.put('memberMergePreview',{...preview,status:'confirmed',mergeId:merged.id});
  // Historical person/record ids stay unchanged. Source sign-in is explicitly retired by the reviewed merge.
  tx.sql.push(tx.statement('UPDATE st_people SET active=0,version=version+1 WHERE id=?',source.id));
  return merged;
}
// Front desk reads credits, bookings and attendance; prices, fees and payers stay in the owner's financial history.
const deskPack = (r: RecordData) => ({id:r.id,personId:r.personId,plan:r.entitlement?.name ?? 'Class credits',credits:r.credits,remaining:r.remaining,expiresAt:r.expiresAt,locationId:r.locationId});
const deskBooking = (r: RecordData) => ({id:r.id,personId:r.personId,classId:r.classId,status:r.status,attendance:r.attendance ?? null,createdAt:r.createdAt,cancelledAt:r.cancelledAt ?? null});
/** Dated source records, never synthetic merged balances, permissions or consent. */
export function memberHistory(state: State,who: Actor,personId: string) {
  requireMemberRecord(state,who,personId);
  const member = person(state,personId,false); insist(member.role === 'member','member_required');
  const ids = who.role === 'owner' ? linkedMemberIds(state,personId) : [personId], ledger={classes:list(state,'class'),bookings:list(state,'booking'),packs:list(state,'pack'),charges:list(state,'charge')}, own = (kind: string) => list(state,kind).filter(r => ids.includes(r.personId) && (who.role === 'owner' || !['pack','packCreditEvent','booking','notice'].includes(kind) || memberRecordVisible(state,who,r.personId,ledgerLocation(r,ledger))));
  const kinds = ['pack','packCreditEvent','booking','charge','payment','acknowledgement','profileChange','staffAction','memberMessage','memberInvitation','memberMerge','memberPreferenceEvent','notice','waiverLaunch','messagePreferenceEvent','familyInvoice','familyTuitionWithdrawal'];
  const timeline = kinds.flatMap(kind => own(kind).map(r => ({kind,id:r.id,personId:r.personId,at:r.at ?? r.createdAt ?? r.acknowledgedAt ?? r.confirmedAt ?? '',
      // Canonical audits retain before/after in staff history. A timeline links their
      // identity/provenance instead of nesting earlier merge previews inside later ones.
      record:kind === 'staffAction' ? {id:r.id,personId:r.personId,command:r.command,actorId:r.actorId,actorRole:r.actorRole,staffMade:r.staffMade,channel:r.channel,right:r.right,at:r.at} : r})))
    .filter(e => who.role === 'owner' || (['profileChange','memberMessage','memberInvitation'].includes(e.kind) || (e.kind === 'staffAction' && ['member.record.create','profile.save.staff','member.record.invite','member.message.send.staff'].includes(e.record.command)))).sort((a,b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  return {personId:member.id,profile:profileOf(state,member),sourceIdentities:ids.map(key => person(state,key,false)),timeline,
    notes:who.role === 'owner' ? own('memberNote') : [],preferences:own('memberPreference').map(p => visiblePreferences(p,who)),
    packs:who.role === 'owner' ? own('pack') : own('pack').map(deskPack),bookings:who.role === 'owner' ? own('booking') : own('booking').map(deskBooking),waivers:own('acknowledgement').map(r=>who.role==='owner'?r:{id:r.id,personId:r.personId,waiverId:r.waiverId,createdAt:r.createdAt}),
    ledger:who.role === 'owner' ? [...own('charge').map(r => ({...r,kind:'charge'})),...own('payment').map(r => ({...r,kind:'payment'}))] : [],
    merges:who.role === 'owner' ? list(state,'memberMerge').filter(m => ids.includes(m.sourceId) || ids.includes(m.targetId)) : []};
}

export function sendMemberMessage(tx: Transaction,input: Record<string,unknown>) {
  const memberId = tx.who.role === 'member' ? tx.who.personId : input.personId;
  if (tx.who.role === 'member') insist(input.personId === undefined || input.personId === memberId,'own_conversation_required',403);
  else requireMemberRecord(tx.state,tx.who,memberId);
  const member = person(tx.state,memberId);insist(member.role === 'member','member_required');
  const message = {id:id(),personId:member.id,text:text(input.text,'message',2000),at:now(),actorId:tx.who.id,actorRole:tx.who.role,
    staffMade:tx.who.role !== 'member',channel:tx.who.role === 'member' ? 'member-account' : staffChannel(input)};
  const requestId = text(input.requestId,'requestId',100), basis = JSON.stringify({personId:member.id,text:message.text,channel:message.channel});
  const prior = list(tx.state,'memberMessage').find(m => m.actorId === tx.who.id && m.requestId === requestId);
  if(prior){insist(prior.requestBasis === basis,'message_request_changed',409);return prior;}
  const saved={...message,requestId,requestBasis:basis};tx.put('memberMessage',saved);return saved;
}
