import { memberRecordGrant, requireMemberRecord } from './member-records';
import { locationById } from './locations';
import { humanOwner, id, insist, now, person, type Actor, type State } from './types';
import type { Transaction } from './store';

export function requireSigningLaunch(state: State,who: Actor,personId: unknown,locationId: string) {
  if(who.role === 'owner' && who.isOwner)return;
  requireMemberRecord(state,who,personId);
  const grant=state.records.get('signing-checkin-grant:'+who.personId)?.data;
  insist(who.role === 'front-desk' && grant?.enabled && grant.recordGrantVersion === memberRecordGrant(state,who)?.version && grant.memberIds.includes(personId) && grant.locationIds.includes(locationId),'checkin_right_required',403);
}
export function grantSigningLaunch(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);
  const staff=person(tx.state,input.personId),grant=memberRecordGrant(tx.state,{...tx.who,personId:staff.id});
  insist(staff.role === 'member' && grant?.enabled,'member_record_grant_required',409);
  insist(typeof input.enabled === 'boolean' && Array.isArray(input.memberIds) && input.memberIds.length<=500 && Array.isArray(input.locationIds) && input.locationIds.length<=100,'invalid_checkin_grant');
  const memberIds=[...new Set(input.memberIds.map(v=>person(tx.state,v).id))].sort();
  insist(memberIds.every(p=>grant.memberIds.includes(p)),'checkin_scope_exceeds_member_records',403);
  const locationIds=[...new Set(input.locationIds.map(v=>locationById(tx.state,v).id))].sort();
  const key='signing-checkin-grant:'+staff.id,prior=tx.state.records.get(key)?.data;
  const saved={id:key,personId:staff.id,memberIds,locationIds,enabled:input.enabled,recordGrantVersion:grant.version,revision:(prior?.revision??0)+1,at:now(),actorId:tx.who.id};
  tx.put('signingCheckinGrant',saved);
  tx.put('signingCheckinGrantEvent',{id:id(),personId:staff.id,before:prior??null,after:saved,at:saved.at,actorId:tx.who.id});
  tx.sql.push(tx.statement('UPDATE oa_operators SET version=version+1 WHERE lower(email)=lower(?)',staff.email));
  return saved;
}
