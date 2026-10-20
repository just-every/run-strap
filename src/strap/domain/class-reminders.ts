import { humanOwner, id, insist, integer, list, now, text, type State } from './types';
import { loadSystem, Transaction } from './store';
import { putNotice, reserveMail, titleOf, whenText } from './notices';

const serviceKey = (value: string) => value.trim().replace(/\s+/g,' ').toLowerCase();
const rules = (state: State) => list(state,'classReminderRule');

function request(tx: Transaction, input: Record<string,unknown>, command: string) {
  const requestId = text(input.requestId,'requestId',100);
  const requestBasis = JSON.stringify(Object.keys(input).sort().map(key => [key,input[key]]));
  const prior = [...list(tx.state,'classReminderRuleEvent'),...list(tx.state,'reminderTaskEvent')]
    .find(event => event.actorId === tx.who.id && event.requestId === requestId);
  if (prior) insist(prior.command === command && prior.requestBasis === requestBasis,'reminder_request_changed',409);
  return {prior,requestId,requestBasis,command,actorId:tx.who.id,actorRole:tx.who.role};
}

/** One studio default and one override per normalized service. A disabled
 * service override disables reminders even when the studio default is enabled. */
export function saveReminderRule(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  insist(typeof input.service === 'string' && input.service.length <= 200,'invalid_service');
  insist(typeof input.enabled === 'boolean','invalid_enabled');
  const leadMinutes = integer(input.leadMinutes,'leadMinutes',1,10080);
  const {prior,...req} = request(tx,input,'reminder.rule.save');
  if (prior) return structuredClone(prior.after);
  const service = input.service.trim().replace(/\s+/g,' '), key = serviceKey(service);
  const ruleId = key ? `class-reminder-rule:service:${encodeURIComponent(key)}` : 'class-reminder-rule:default';
  const before = tx.state.records.get(ruleId)?.data ?? null;
  const revision = integer(input.revision ?? (before ? undefined : 0),'revision',0,Number.MAX_SAFE_INTEGER);
  insist(revision === (before?.revision ?? 0),'reminder_rule_changed',409);
  const at = now();
  const saved = {id:ruleId,service,serviceKey:key,enabled:input.enabled,leadMinutes,revision:revision+1,
    createdAt:before?.createdAt ?? at,createdBy:before?.createdBy ?? tx.who.id,updatedAt:at,updatedBy:tx.who.id};
  tx.put('classReminderRule',saved);
  tx.put('classReminderRuleEvent',{id:id(),...req,ruleId,before:before ? structuredClone(before) : null,after:structuredClone(saved),at});
  return saved;
}

/** No future queue is retained: every sweep reads the current start, booking
 * and rule. Rule edits never issue a second reminder for the same occurrence. */
export function processClassReminders(tx: Transaction) {
  const at = now(), time = Date.parse(at), configured = rules(tx.state);
  for (const booking of list(tx.state,'booking')) {
    if (booking.status !== 'booked' || booking.attendance || booking.checkedInAt) continue;
    const member = tx.state.people.find(p => p.id === booking.personId && p.role === 'member' && p.active && !p.erasedAt);
    if (!member) continue;
    const entry = tx.state.records.get(booking.classId)?.data;
    if (!entry || entry.status !== 'published' || Date.parse(entry.start) <= time) continue;
    const key = serviceKey(String(entry.service ?? titleOf(entry)));
    const rule = configured.find(r => r.serviceKey === key) ?? configured.find(r => r.serviceKey === '');
    if (!rule?.enabled || Date.parse(entry.start) > time + rule.leadMinutes*60_000) continue;
    const sourceId = `reminder:${booking.id}:${entry.id}:${Date.parse(entry.start).toString(36)}`;
    if (tx.state.records.has(sourceId)) continue;
    tx.future(entry.start); tx.reached(new Date(Date.parse(entry.start)-rule.leadMinutes*60_000).toISOString());
    const subject = `Class reminder: ${titleOf(entry)}, ${whenText(tx.state,entry.start)}`;
    const body = 'Your class is coming up. Review your booking and its current cancellation policy in Strap.';
    putNotice(tx,{id:`notice:${sourceId}`,personId:member.id,bookingId:booking.id,classId:entry.id,reminderId:sourceId,subject,body});
    const delivery = reserveMail(tx,tx.notices,{id:`mail:${sourceId}`,sourceKind:'reminder',sourceId,personId:member.id,bookingIds:[booking.id],subject,body});
    tx.put('classReminder',{id:sourceId,sourceId,bookingId:booking.id,personId:member.id,classId:entry.id,start:entry.start,
      ruleId:rule.id,ruleRevision:rule.revision,leadMinutes:rule.leadMinutes,deliveryId:delivery.id,reservationStatus:delivery.status,
      at,actorId:'system',actorRole:'system',triggeredBy:tx.who.id});
  }
}

/** Provider submission failure or unavailable/uncertain dispatch creates a
 * follow-up task, never another send attempt. Its status is an observation. */
export async function reconcileReminderFailures(db: D1Database) {
  const loaded = await loadSystem(db), tx = new Transaction(db,loaded.state,loaded.who);
  const failed = await db.prepare("SELECT id,source_id AS sourceId,person_id AS personId,status,provider,code FROM st_notice_deliveries WHERE source_kind='reminder' AND status IN ('rejected','rate_limited','uncertain','sending','queued','not_configured','no_address','paused') ORDER BY created_at,id")
    .all<{id:string;sourceId:string;personId:string;status:string;provider:string|null;code:string|null}>();
  for (const delivery of failed.results) {
    const taskId = `reminder-task:${delivery.id}`;
    if (tx.state.records.has(taskId)) continue;
    const reminder = tx.state.records.get(delivery.sourceId)?.data;
    if (!reminder) continue;
    tx.put('reminderTask',{id:taskId,deliveryId:delivery.id,reminderId:delivery.sourceId,personId:delivery.personId,
      bookingId:reminder.bookingId,classId:reminder.classId,start:reminder.start,status:'open',deliveryStatus:delivery.status,
      provider:delivery.provider,code:delivery.code,createdAt:now(),actorId:'system',actorRole:'system'});
  }
  if (tx.sql.length) await tx.commit();
}

export function completeReminderTask(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const reason = text(input.reason,'reason',500), {prior,...req} = request(tx,input,'reminder.task.complete');
  if (prior) return structuredClone(prior.after);
  const row = tx.state.records.get(text(input.id,'id',500));
  insist(row?.kind === 'reminderTask','reminder_task_not_found',404);
  const before = row.data;
  insist(before.status === 'open','reminder_task_already_completed',409);
  const after = {...before,status:'completed',completedAt:now(),completedBy:tx.who.id,reason};
  tx.put('reminderTask',after);
  tx.put('reminderTaskEvent',{id:id(),...req,taskId:after.id,personId:before.personId,before:structuredClone(before),after:structuredClone(after),at:after.completedAt});
  return after;
}
