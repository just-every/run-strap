import { humanOwner, insist, integer, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';

const key = (personId: string) => encodeURIComponent(personId);
const preferenceId = (personId: string) => `recognition-preference:${key(personId)}`;
const recognitionId = (personId: string, threshold: number) => `recognition:${key(personId)}:${threshold}`;
const preference = (state: State, personId: string) => list(state,'recognitionPreference').find(p => p.personId === personId);
const memberActive = (state: State, personId: string) => state.people.some(p => p.id === personId && p.role === 'member' && p.active && !p.erasedAt);
function visits(state: State, personId: string) {
  return [...new Set(list(state,'booking').filter(b => b.personId === personId && b.attendance === 'attended').map(b => b.id))].sort();
}
function version(input: unknown, previous?: RecordData) {
  const expected = integer(input === undefined && !previous ? 0 : input,'version',0,Number.MAX_SAFE_INTEGER);
  insist(expected === (previous?.version ?? 0),'recognition_changed',409);
  return expected+1;
}
function suppression(state: State, task: RecordData, count: number) {
  if (!memberActive(state,task.personId)) return 'member_inactive';
  if (!preference(state,task.personId)?.optedIn) return 'opted_out';
  if (!list(state,'milestone').some(r => r.id === task.ruleId && r.enabled)) return 'milestone_disabled';
  return count < task.threshold ? 'attendance_corrected' : null;
}

/** Threshold is the permanent rule identity. Edits retain immutable definitions;
 * changing a label or enabling the same rule can never create another issuance. */
export function saveMilestone(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const previous = input.id === undefined ? undefined : record(tx.state,input.id,'milestone');
  const threshold = integer(input.threshold,'threshold'), label = text(input.label,'milestone_label',160);
  insist(typeof input.enabled === 'boolean','invalid_enabled');
  insist(!previous || previous.threshold === threshold,'milestone_threshold_is_immutable',409);
  const stableId = `milestone:${threshold}`;
  insist(previous || !tx.state.records.has(stableId),'milestone_already_exists',409);
  const saved = {id:stableId,threshold,label,enabled:input.enabled,version:version(input.version,previous),
    createdAt:previous?.createdAt ?? now(),createdBy:previous?.createdBy ?? tx.who.id,updatedAt:now(),updatedBy:tx.who.id};
  tx.put('milestoneRevision',{...saved,id:`milestone-revision:${threshold}:${saved.version}`,ruleId:stableId});
  tx.put('milestone',saved);
  processRecognition(tx);
  return saved;
}

/** Consent is an authenticated member's own action. Its origin is fixed by this
 * door; an owner or an arbitrary source string cannot act on a member's behalf. */
export function saveRecognitionPreference(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'member' && tx.who.personId,'member_required',403);
  const member = person(tx.state,tx.who.personId);
  insist(member.role === 'member','member_required',403);
  insist(input.personId === undefined || input.personId === member.id,'own_preference_required',403);
  insist(input.source === undefined || input.source === 'member_account','invalid_preference_source');
  insist(typeof input.optedIn === 'boolean','invalid_opted_in');
  const previous = preference(tx.state,member.id), nextVersion = version(input.version,previous), at = now();
  const event = {id:`${preferenceId(member.id)}:event:${nextVersion}`,personId:member.id,version:nextVersion,
    optedIn:input.optedIn,previousOptedIn:previous?.optedIn ?? false,actorId:tx.who.id,actorRole:tx.who.role,at,source:'member_account'};
  const saved = {id:preferenceId(member.id),personId:member.id,optedIn:input.optedIn,version:nextVersion,
    updatedAt:at,updatedBy:tx.who.id,source:'member_account'};
  tx.put('recognitionPreferenceEvent',event);
  tx.put('recognitionPreference',saved);
  processRecognition(tx);
  return {...saved,history:list(tx.state,'recognitionPreferenceEvent').filter(e => e.personId === member.id)};
}

/** Internal reconciliation, callable after attendance changes by any legitimate
 * transaction actor. The explicit HTTP process command must be owner-only.
 * Suppressed and completed identities remain durable and are never reopened. */
export function processRecognition(tx: Transaction) {
  const created: RecordData[] = [], suppressed: RecordData[] = [], at = now();
  const counts = new Map<string,string[]>();
  const source = (personId: string) => {
    if (!counts.has(personId)) counts.set(personId,visits(tx.state,personId));
    return counts.get(personId)!;
  };
  for (const task of list(tx.state,'recognition')) {
    if (task.status !== 'open') continue;
    const count = source(task.personId).length, reason = suppression(tx.state,task,count);
    if (!reason) continue;
    const saved = {...task,status:'suppressed',version:task.version+1,suppressedAt:at,suppressedBy:tx.who.id,
      suppressedByRole:tx.who.role,suppressionReason:reason,currentCount:count};
    tx.put('recognition',saved); suppressed.push(saved);
  }
  const rules = list(tx.state,'milestone').filter(r => r.enabled);
  for (const member of tx.state.people) {
    if (!memberActive(tx.state,member.id) || !preference(tx.state,member.id)?.optedIn) continue;
    const sourceBookingIds = source(member.id), count = sourceBookingIds.length;
    for (const rule of rules) {
      const stableId = recognitionId(member.id,rule.threshold);
      if (count < rule.threshold || tx.state.records.has(stableId)) continue;
      const saved = {id:stableId,personId:member.id,ruleId:rule.id,ruleVersion:rule.version,threshold:rule.threshold,
        label:rule.label,count,sourceBookingIds:[...sourceBookingIds],preferenceVersion:preference(tx.state,member.id)!.version,
        status:'open',version:1,createdAt:at,createdBy:tx.who.id,createdByRole:tx.who.role};
      tx.put('recognition',saved); created.push(saved);
    }
  }
  return {created,suppressed};
}

/** Owner completion is a once-only private staff action. Exact request replays
 * return the accepted record; reusing a request with another task/version fails. */
export function completeRecognition(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const taskId = text(input.id,'id',200), expected = integer(input.version,'version'), requestId = text(input.requestId,'request_id',100);
  const requestBasis = JSON.stringify({id:taskId,version:expected});
  const previous = list(tx.state,'recognition').find(r => r.completedBy === tx.who.id && r.completionRequestId === requestId);
  if (previous) {
    insist(previous.completionRequestBasis === requestBasis,'recognition_request_changed',409);
    insist(memberActive(tx.state,previous.personId),'active_member_required',409);
    return previous;
  }
  const task = record(tx.state,taskId,'recognition');
  insist(memberActive(tx.state,task.personId),'active_member_required',409);
  insist(task.version === expected,'recognition_changed',409);
  insist(task.status === 'open','recognition_not_open',409);
  const sourceBookingIds = visits(tx.state,task.personId), count = sourceBookingIds.length;
  insist(!suppression(tx.state,task,count),'recognition_no_longer_eligible',409);
  const saved = {...task,status:'completed',version:task.version+1,completedAt:now(),completedBy:tx.who.id,
    completionRequestId:requestId,completionRequestBasis:requestBasis,completionCount:count,completionSourceBookingIds:sourceBookingIds};
  tx.put('recognition',saved); return saved;
}

/** Private tasks are never exposed to instructors, agents or members. Members
 * can inspect their own current consent, immutable choices and counted progress. */
export function recognitionSnapshot(state: State, who: Actor) {
  const empty = {milestones:[] as RecordData[],preferences:[] as RecordData[],recognitions:[] as RecordData[],progress:[] as RecordData[]};
  const owner = who.role === 'owner' && who.isOwner;
  if (!owner && (who.role !== 'member' || !who.personId || !memberActive(state,who.personId))) return empty;
  const rules = list(state,'milestone').sort((a,b) => a.threshold-b.threshold);
  const members = state.people.filter(p => p.role === 'member' && !p.erasedAt && (owner || p.id === who.personId)).sort((a,b) => a.id.localeCompare(b.id));
  const preferences = members.map(member => {
    const current = preference(state,member.id);
    return {id:preferenceId(member.id),personId:member.id,optedIn:false,version:0,...current,
      history:list(state,'recognitionPreferenceEvent').filter(e => e.personId === member.id).sort((a,b) => a.version-b.version)};
  });
  const progress = members.map(member => ({id:member.id,personId:member.id,count:visits(state,member.id).length}));
  const recognitions = owner ? list(state,'recognition') : [];
  const milestones = owner ? rules.map(rule => ({...rule,revisions:list(state,'milestoneRevision').filter(r => r.ruleId === rule.id)}))
    : rules.filter(r => r.enabled).map(({id,threshold,label,version,enabled}) => ({id,threshold,label,version,enabled}));
  return {milestones,preferences,recognitions,progress};
}
