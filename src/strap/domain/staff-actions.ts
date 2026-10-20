import { humanOwner, id, insist, list, now, person, record, text, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { latestWaiver } from './bookings';
import { memberCheckin } from './checkin';
import { memberMail } from './notices';

export const staffChannel = (input: Record<string,unknown>) => { const channel = text(input.channel ?? 'desk','channel',20); insist(['desk','phone','inbox'].includes(channel),'invalid_channel'); return channel; };
export const staffActions = (state: State) => [...list(state,'staffAction'),...list(state,'bookingAction').filter(a => a.staffMade)].sort((a,b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
export const requestBasis = (input: Record<string,unknown>) => JSON.stringify(Object.keys(input).sort().map(key => [key,input[key]]));
const codeEffect = (value: RecordData | null) => ({issued:!!value?.code,codeRevision:value?.codeRevision ?? 0,codeIssuedAt:value?.codeIssuedAt ?? null});
const noticeEffect = (value: RecordData) => ({id:value.id,personId:value.personId,dismissedAt:value.dismissedAt ?? null,dismissedByStaff:value.dismissedByStaff ?? null});
export function staffBefore(tx: Transaction, name: string, input: Record<string,unknown>) {
  if (name === 'checkin.code.staff' || name === 'checkin.rotate') return codeEffect(memberCheckin(tx.state,String(input.personId)));
  if (name === 'waiver.launch') return {waiverId:latestWaiver(tx.state)?.id ?? null,acknowledged:list(tx.state,'acknowledgement').some(a => a.personId === input.personId && a.waiverId === input.waiverId)};
  if (name === 'plan.change.prepare') { const pack = tx.state.records.get(String(input.packId))?.data; return pack ? structuredClone(pack) : null; }
  const target = typeof input.id === 'string' ? tx.state.records.get(input.id)?.data : null;
  if (name === 'notice.dismiss.staff') return target ? noticeEffect(target) : null;
  return target ? structuredClone(target) : null;
}
export function staffAfter(name: string, result: RecordData) {
  if (name === 'checkin.code.staff' || name === 'checkin.rotate') return codeEffect(result);
  if (name === 'notice.dismiss.staff') return noticeEffect(result);
  return structuredClone(result);
}
export function priorStaffRequest(tx: Transaction, name: string, input: Record<string,unknown>) {
  if (tx.who.role !== 'owner' || !input.requestId) return null;
  humanOwner(tx.who);
  const requestId = text(input.requestId,'requestId',100), basis = requestBasis(input);
  const prior = staffActions(tx.state).find(a => a.actorId === tx.who.id && a.requestId === requestId);
  if (!prior) return null;
  insist(prior.command === name && prior.requestBasis === basis,'staff_request_changed',409);
  if (name === 'checkin.code.staff' || name === 'checkin.rotate') {
    person(tx.state,input.personId);
    const current = memberCheckin(tx.state,String(input.personId));
    insist(current && current.codeRevision === prior.after.codeRevision,'checkin_code_changed',409); return current;
  }
  return prior.result ?? prior.after;
}
/** One canonical entry; SCHED-014 already made one, so annotate rather than duplicate it. */
export function retainStaffAction(tx: Transaction, name: string, right: string, input: Record<string,unknown>, result: RecordData, before: unknown, priorIds: Set<string>) {
  const channel = staffChannel(input), after = staffAfter(name,result);
  const personId = result.personId ?? input.personId;
  const existing = list(tx.state,'bookingAction').find(a => !priorIds.has(a.id) && a.staffMade && a.actorId === tx.who.id);
  const metadata = {command:name,...(input.requestId ? {requestId:text(input.requestId,'requestId',100),requestBasis:requestBasis(input),result:after} : {})};
  if (existing) { tx.put('bookingAction',{...existing,...metadata}); return; }
  const event = {id:id(),action:name,actorId:tx.who.id,actorRole:tx.who.role,staffMade:true,right,personId,channel,before,after,reason:typeof input.reason === 'string' ? input.reason : null,at:now(),...metadata};
  tx.put('staffAction',event);
}
export function dismissForMember(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who); text(input.requestId,'requestId',100);
  const member = person(tx.state,input.personId), notice = record(tx.state,input.id,'notice');
  insist(notice.personId === member.id,'notice_member_mismatch',403);
  insist(!notice.dismissedAt,'notice_already_read',409);
  const at = now(), updated = {...notice,dismissedAt:at,dismissedByStaff:{actorId:tx.who.id,actorRole:tx.who.role,at,channel:staffChannel(input)}};
  tx.put('notice',updated); return updated;
}
export function launchWaiver(tx: Transaction, input: Record<string,unknown>, context: {origin?: string} = {}) {
  humanOwner(tx.who);
  const connection = memberMail(tx.state);
  insist(!connection || connection.origin === context.origin,'member_email_reconnect_required',409);
  const member = person(tx.state,input.personId), waiver = latestWaiver(tx.state);
  insist(member.role === 'member','member_required');
  insist(waiver && input.waiverId === waiver.id,'not_latest_version',409);
  const requestId = text(input.requestId,'requestId',100), channel = staffChannel(input);
  if (!connection && context.origin) tx.put('mailConnection',{id:'member-mail',origin:context.origin,connectedAt:now(),connectedBy:'first-use'});
  const launch = {id:id(),personId:member.id,waiverId:waiver.id,requestId,channel,status:'requested',createdAt:now(),createdBy:tx.who.id};
  tx.put('waiverLaunch',launch);
  tx.sql.push(tx.statement("INSERT INTO st_waiver_launch_dispatches(id,status,origin) VALUES(?,'queued',?)",launch.id,context.origin ?? ''));
  return launch;
}
