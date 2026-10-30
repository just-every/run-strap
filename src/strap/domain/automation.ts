import { sha256 } from '../../modules/import-kit/src/d1/index';
import { humanOwner, id, insist, instant, integer, list, now, record, text, type Actor, type RecordData, type State } from './types';
import { Transaction } from './store';
import { reviewNurtureSource } from './leads';
import { enrollRenewalSource, reviewRenewalQueue } from './renewal-sequences';
import { permission, preferencesOf, type MarketingChannel } from './preferences';
import { renewalCandidates } from './renewals';

const open = (task: RecordData) => ['queued','held'].includes(task.status);
const stopConditions = ['member inactive or erased','channel permission withdrawn','source expired or renewed','intro membership purchased or member replied','sequence paused','rule paused or schedule ended'];
function sources(state: State, rule: RecordData) {
  const sequence = state.records.get(rule.sequenceId)?.data;
  const renewal = rule.trigger === 'renewal' ? renewalCandidates(state,new URLSearchParams({days:String(rule.days),lowCredits:String(rule.lowCredits)})).rows : [];
  const candidates = rule.trigger === 'intro' ? list(state,'introSale').filter(s => s.offerId === sequence?.introOfferId) : list(state,'pack').filter(p => !p.introSaleId);
  return candidates.map(source => {
    const member = state.people.find(p => p.id === source.personId && p.role === 'member' && !p.erasedAt);
    let reason: string | null = !member?.active ? 'member_inactive' : permission(state,source.personId,rule.channel as MarketingChannel);
    if (!reason && !sequence?.enabled) reason = 'sequence_paused';
    if (!reason && source.expiresAt <= now()) reason = 'source_expired';
    if (!reason && rule.trigger === 'intro') {
      if (list(state,'pack').some(p => p.personId === source.personId && !p.introSaleId && p.entitlement && p.createdAt >= source.createdAt)) reason = 'membership_purchased';
      else if (list(state,'memberMessage').some(m => m.personId === source.personId && m.actorRole === 'member' && m.at >= source.createdAt)) reason = 'member_replied';
    }
    if (!reason && rule.trigger === 'renewal' && !renewal.some(r => r.packId === source.id)) reason = 'source_no_longer_eligible';
    return {sourceId:source.id,personId:source.personId,reason,basis:sha256(JSON.stringify([source,member?.version,preferencesOf(state,source.personId).revision]))};
  }).sort((a,b) => a.sourceId.localeCompare(b.sourceId));
}
function audienceBasis(state: State, rule: RecordData) { return sha256(JSON.stringify(sources(state,rule))); }
export function prepareAutomation(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);
  const trigger = text(input.trigger,'trigger',10);insist(['intro','renewal'].includes(trigger),'invalid_trigger');
  const sequence = record(tx.state,input.sequenceId,trigger === 'intro' ? 'nurtureSequence' : 'renewalSequence');
  const channel = trigger === 'intro' ? 'inApp' : sequence.channel;
  insist(input.channel === channel,'sequence_channel_required');
  const startAt = instant(input.startAt,'startAt'), endAt = instant(input.endAt,'endAt');
  insist(startAt < endAt && endAt > now(),'invalid_schedule');
  const rule = {id:id(),name:text(input.name,'name',100),trigger,sequenceId:sequence.id,channel,startAt,endAt,
    maxMessages:integer(input.maxMessages ?? Number(input.maxTasks)*(trigger === 'intro' ? 3 : 1),'maxMessages',1,3000),
    intervalMinutes:integer(input.intervalMinutes,'intervalMinutes',1,10080),maxTasks:integer(input.maxTasks,'maxTasks',1,1000),
    days:integer(input.days ?? 30,'days',1,366),lowCredits:integer(input.lowCredits ?? 1,'lowCredits',0,10000),
    stopConditions,escalation:'private-owner-review',effect:'private-task-only',status:'preview',createdAt:now(),createdBy:tx.who.id};
  const saved = {...rule,key:id(),basis:audienceBasis(tx.state,rule)};
  tx.sql.push(tx.statement('INSERT INTO st_automation_reviews(id,rule_id,review_key) VALUES(?,?,?)',saved.id,saved.id,saved.key));
  tx.put('automationPreview',saved);return {...saved,audience:sources(tx.state,rule)};
}
export async function enableAutomation(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);const preview = record(tx.state,input.id,'automationPreview');
  insist(preview.createdBy === tx.who.id && preview.key === input.key,'automation_preview_changed',409);
  await requireReview(tx,preview);
  insist(preview.basis === audienceBasis(tx.state,preview) && preview.endAt > now(),'automation_audience_changed',409);
  const prior = list(tx.state,'automationRule').find(r => r.previewId === preview.id);
  if (prior) return prior;
  const {key:_,basis:__,status:___,...config} = preview;
  const rule = {...config,id:id(),previewId:preview.id,enabled:true,epoch:id(),approvedAt:now(),approvedBy:tx.who.id};
  tx.sql.push(tx.statement('INSERT INTO st_automation_connections(rule_id,epoch) VALUES(?,?)',rule.id,rule.epoch));
  tx.put('automationRule',rule);tx.put('automationPreview',{...preview,status:'enabled',ruleId:rule.id});return rule;
}
export async function setAutomation(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);const rule = record(tx.state,input.id,'automationRule');
  insist(input.enabled === false,'fresh_preview_required_to_resume',409);
  tx.sql.push(tx.statement('DELETE FROM st_automation_connections WHERE rule_id=?',rule.id));
  const saved = {...rule,enabled:false,pausedAt:now(),pausedBy:tx.who.id};tx.put('automationRule',saved);
  for (const task of list(tx.state,'automationTask').filter(t => t.ruleId === rule.id && open(t))) {
    tx.put('automationTask',{...task,status:'held',reason:'rule_paused',updatedAt:now()});
  }
  tx.put('automationEvent',{id:id(),ruleId:rule.id,action:'paused',at:now(),actorId:tx.who.id});return saved;
}
/** Resumption reviews the current audience and original budget, never starts a fresh budget. */
export function previewAutomationResume(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);const rule = record(tx.state,input.id,'automationRule');
  const saved = {id:id(),ruleId:rule.id,key:id(),basis:audienceBasis(tx.state,rule),createdBy:tx.who.id,createdAt:now(),status:'preview'};
  for (const prior of list(tx.state,'automationResume').filter(p => p.ruleId === rule.id && p.status === 'preview')) tx.put('automationResume',{...prior,status:'superseded'});
  tx.sql.push(tx.statement('DELETE FROM st_automation_reviews WHERE rule_id=?',rule.id));
  tx.sql.push(tx.statement('INSERT INTO st_automation_reviews(id,rule_id,review_key) VALUES(?,?,?)',saved.id,rule.id,saved.key));
  tx.put('automationResume',saved);return {...saved,audience:sources(tx.state,rule)};
}
export async function resumeAutomation(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);const preview = record(tx.state,input.id,'automationResume'),rule = record(tx.state,preview.ruleId,'automationRule');
  insist(preview.createdBy === tx.who.id && preview.key === input.key && preview.basis === audienceBasis(tx.state,rule),'automation_audience_changed',409);
  await requireReview(tx,preview);
  insist(rule.endAt > now(),'schedule_ended',409);
  if (preview.status === 'approved') return rule;
  const saved = {...rule,enabled:true,epoch:id(),approvedAt:now(),approvedBy:tx.who.id};
  tx.sql.push(tx.statement('INSERT INTO st_automation_connections(rule_id,epoch) VALUES(?,?) ON CONFLICT(rule_id) DO UPDATE SET epoch=excluded.epoch',rule.id,saved.epoch));
  tx.put('automationRule',saved);tx.put('automationResume',{...preview,status:'approved'});
  tx.put('automationEvent',{id:id(),ruleId:rule.id,action:'resumed',at:now(),actorId:tx.who.id});return saved;
}
async function requireReview(tx: Transaction,preview: RecordData) {
  insist(await tx.db.prepare('SELECT id FROM st_automation_reviews WHERE id=? AND review_key=?').bind(preview.id,preview.key).first(),'automation_review_disconnected',409);
}
async function connected(tx: Transaction,rule: RecordData) {
  return !!await tx.db.prepare('SELECT rule_id FROM st_automation_connections WHERE rule_id=? AND epoch=?').bind(rule.id,rule.epoch).first();
}
function scheduleReason(rule: RecordData,at: string) { return !rule.enabled ? 'rule_paused' : at < rule.startAt ? 'schedule_not_started' : at >= rule.endAt ? 'schedule_ended' : null; }
function outcome(tx: Transaction,runId: string,rule: RecordData,source: {sourceId:string;personId:string},status: string,reason: string) {
  tx.put('automationOutcome',{id:id(),runId,ruleId:rule.id,trigger:rule.trigger,sourceId:source.sourceId,personId:source.personId,status,reason,at:now()});
}
/** The scheduler may create private review tasks; no message, reward or financial door is called. */
async function evaluate(tx: Transaction,rule: RecordData,requestId: string,scheduled: boolean) {
  const prior = list(tx.state,'automationRun').find(r => r.ruleId === rule.id && r.requestId === requestId);if (prior) return prior;
  const at = now(), runId = id(),authority = await connected(tx,rule),held = scheduleReason(rule,at) ?? (!authority ? 'execution_disconnected' : null);
  let queued = 0,skipped = 0,exceptions = 0;
  const candidates = sources(tx.state,rule);
  for (const source of candidates) {
    const key = 'automation-task:'+rule.trigger+':'+source.sourceId,task = tx.state.records.get(key)?.data;
    const reason = source.reason ?? held;
    if (reason) {
      if (task?.ruleId === rule.id && open(task)) tx.put('automationTask',{...task,status:source.reason ? 'suppressed' : 'held',reason,updatedAt:at});
      outcome(tx,runId,rule,source,reason === 'execution_disconnected' ? 'exception' : 'skipped',reason);
      if (reason === 'execution_disconnected') exceptions++;else skipped++;
      continue;
    }
    if (task) {
      if (task.ruleId === rule.id && task.status === 'held') tx.put('automationTask',{...task,status:'queued',reason:null,updatedAt:at});
      outcome(tx,runId,rule,source,'skipped',task.status === 'suppressed' ? 'trigger_suppressed' : 'trigger_already_retained');skipped++;continue;
    }
    if (list(tx.state,'automationTask').filter(t => t.ruleId === rule.id).length >= rule.maxTasks) {
      outcome(tx,runId,rule,source,'exception','task_budget_exhausted');exceptions++;continue;
    }
    tx.put('automationTask',{id:key,trigger:rule.trigger,sourceId:source.sourceId,personId:source.personId,ruleId:rule.id,channel:rule.channel,
      sequenceId:rule.sequenceId,status:'queued',reason:null,createdAt:at,createdBy:tx.who.id,nextAction:'Review current source and permission before any separate message approval'});
    outcome(tx,runId,rule,source,'queued','owner_review_required');queued++;
  }
  const run = {id:runId,ruleId:rule.id,requestId,at,actorId:tx.who.id,scheduled,queued,skipped,exceptions,reason:held ?? (candidates.length ? null : 'no_retained_sources')};
  tx.put('automationRun',run);return run;
}
export async function evaluateAutomation(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);return evaluate(tx,record(tx.state,input.id,'automationRule'),text(input.requestId,'requestId',100),false);
}
export async function sweepAutomation(tx: Transaction) {
  for (const rule of list(tx.state,'automationRule').filter(r => r.enabled)) {
    const slot = Math.floor((Date.now()-Date.parse(rule.startAt))/(rule.intervalMinutes*60000));
    if (slot < 0 || now() >= rule.endAt || !await connected(tx,rule)) continue;
    await evaluate(tx,rule,'scheduled:'+slot,true);
  }
}
/** Any ordinary source or consent mutation immediately retires ineligible queued work. */
export function suppressAutomation(tx: Transaction) {
  for (const task of list(tx.state,'automationTask').filter(open)) {
    const rule = tx.state.records.get(task.ruleId)?.data;
    const source = rule && sources(tx.state,rule).find(s => s.sourceId === task.sourceId);
    const stopped = !source ? 'source_unavailable' : source.reason;
    const reason = stopped ?? (!rule ? 'rule_unavailable' : scheduleReason(rule,now()));
    if (reason && (task.reason !== reason || task.status !== (stopped ? 'suppressed' : 'held'))) tx.put('automationTask',{...task,status:stopped ? 'suppressed' : 'held',reason,updatedAt:now()});
  }
}
export async function completeAutomationTask(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);const task = record(tx.state,input.id,'automationTask'),rule = record(tx.state,task.ruleId,'automationRule');
  insist(await connected(tx,rule) && !scheduleReason(rule,now()),'automation_not_authorized',409);
  const source = sources(tx.state,rule).find(s => s.sourceId === task.sourceId);
  insist(source && !source.reason && ['queued','reviewed'].includes(task.status),'automation_task_no_longer_eligible',409);
  if (task.status === 'reviewed') return task;
  const saved = {...task,status:'reviewed',reviewedAt:now(),reviewedBy:tx.who.id};tx.put('automationTask',saved);
  tx.put('automationEvent',{id:id(),ruleId:rule.id,personId:task.personId,sourceId:task.sourceId,action:'reviewed',at:now(),actorId:tx.who.id});return saved;
}
/** Review authority is installation-local; an archive retains evidence but no capability. */
async function deliveryTask(tx: Transaction,taskId: unknown) {
  humanOwner(tx.who);
  const task=record(tx.state,taskId,'automationTask'),rule=record(tx.state,task.ruleId,'automationRule');
  insist(await connected(tx,rule) && !scheduleReason(rule,now()),'automation_not_authorized',409);
  const source=sources(tx.state,rule).find(s=>s.sourceId === task.sourceId);
  insist(source && !source.reason && ['queued','reviewed'].includes(task.status),'automation_task_no_longer_eligible',409);
  insist(rule.channel === 'inApp','provider_delivery_unavailable',409);
  return {task,rule,source};
}
function applyDelivery(tx: Transaction,task: RecordData,rule: RecordData) {
  if(rule.trigger === 'intro')reviewNurtureSource(tx,task.sourceId,rule.sequenceId);
  else {
    const query=new URLSearchParams({days:String(rule.days),lowCredits:String(rule.lowCredits)});
    const message=enrollRenewalSource(tx,rule.sequenceId,task.sourceId,query);
    reviewRenewalQueue(tx,new Set([message.id]),query);
  }
}
/** Preview uses the real native source operation on an isolated transaction, without writes. */
function deliveryPlan(tx: Transaction,task: RecordData,rule: RecordData) {
  const scratch=new Transaction(tx.db,structuredClone(tx.state),tx.who);
  applyDelivery(scratch,task,rule);
  return list(scratch.state,'memberMessage').filter(m=>!tx.state.records.has(m.id)).map(m=>{
    const offer=m.nurtureOfferId ? record(scratch.state,m.nurtureOfferId,'nurtureOffer') : null;
    return {step:m.step ?? 'renewal',text:m.text,channel:m.channel,terms:offer?.terms ?? null,bookingId:offer?.bookingId ?? null};
  });
}
const messageLimit=(rule: RecordData)=>rule.maxMessages ?? rule.maxTasks*(rule.trigger === 'intro' ? 3 : 1);
const usedMessages=(state: State,rule: RecordData)=>list(state,'automationDelivery').filter(d=>d.ruleId === rule.id).reduce((sum,d)=>sum+d.messageCount,0);
function deliveryBasis(rule: RecordData,source: {basis:string},messages: unknown[]) {
  return sha256(JSON.stringify([rule.epoch,source.basis,messages]));
}
export async function previewAutomationDelivery(tx: Transaction,input: Record<string,unknown>) {
  const {task,rule,source}=await deliveryTask(tx,input.id),messages=deliveryPlan(tx,task,rule);
  insist(messages.length,'automation_no_pending_messages',409);
  insist(usedMessages(tx.state,rule)+messages.length <= messageLimit(rule),'automation_message_budget_exhausted',409);
  const preview={id:id(),taskId:task.id,ruleId:rule.id,sourceId:source.sourceId,personId:task.personId,key:id(),messages,
    basis:deliveryBasis(rule,source,messages),status:'preview',createdAt:now(),createdBy:tx.who.id};
  tx.sql.push(tx.statement('INSERT INTO st_automation_reviews(id,rule_id,review_key) VALUES(?,?,?)',preview.id,rule.id,preview.key));
  tx.put('automationDeliveryPreview',preview);return preview;
}
export async function confirmAutomationDelivery(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);const preview=record(tx.state,input.id,'automationDeliveryPreview');
  insist(preview.createdBy === tx.who.id && preview.key === input.key && input.confirm === true,'automation_delivery_confirmation_required',409);
  const {task,rule,source}=await deliveryTask(tx,preview.taskId);
  await requireReview(tx,preview);
  if(preview.status === 'approved')return record(tx.state,preview.deliveryId,'automationDelivery');
  const messages=deliveryPlan(tx,task,rule);
  insist(messages.length && preview.basis === deliveryBasis(rule,source,messages),'automation_delivery_changed',409);
  insist(usedMessages(tx.state,rule)+messages.length <= messageLimit(rule),'automation_message_budget_exhausted',409);
  tx.future(rule.endAt);
  const before=new Set(list(tx.state,'memberMessage').map(m=>m.id));
  applyDelivery(tx,task,rule);
  const delivered=list(tx.state,'memberMessage').filter(m=>!before.has(m.id));
  const receipt={id:id(),ruleId:rule.id,taskId:task.id,sourceId:task.sourceId,personId:task.personId,trigger:rule.trigger,
    messageIds:delivered.map(m=>m.id),messageCount:delivered.length,at:now(),approvedBy:tx.who.id,previewId:preview.id};
  tx.put('automationDelivery',receipt);
  tx.put('automationDeliveryPreview',{...preview,status:'approved',deliveryId:receipt.id});
  tx.put('automationTask',{...task,status:'reviewed',reviewedAt:receipt.at,reviewedBy:tx.who.id});
  tx.put('automationEvent',{id:id(),ruleId:rule.id,sourceId:task.sourceId,personId:task.personId,action:'messages_approved',messageCount:receipt.messageCount,at:receipt.at,actorId:tx.who.id});
  return receipt;
}
export async function automationSnapshot(db: D1Database,state: State,who: Actor) {
  if (who.role !== 'owner') return null;
  const connections = (await db.prepare('SELECT rule_id,epoch FROM st_automation_connections').all<{rule_id:string;epoch:string}>()).results;
  return {rules:list(state,'automationRule').map(r => ({...r,maxMessages:messageLimit(r),usedMessages:usedMessages(state,r),connected:connections.some(c => c.rule_id === r.id && c.epoch === r.epoch)})),
    deliveryPreviews:list(state,'automationDeliveryPreview'),deliveries:list(state,'automationDelivery'),
    previews:list(state,'automationPreview').map(p => ({...p,audience:sources(state,p),stale:p.basis !== audienceBasis(state,p)})),
    resumes:list(state,'automationResume').map(p => ({...p,audience:sources(state,state.records.get(p.ruleId)!.data)})),
    tasks:list(state,'automationTask').map(t => {const rule = state.records.get(t.ruleId)?.data;return open(t) && !connections.some(c => c.rule_id === rule?.id && c.epoch === rule?.epoch) ? {...t,status:'held',reason:rule?.enabled ? 'execution_disconnected' : 'rule_paused'} : t;}),runs:list(state,'automationRun'),outcomes:list(state,'automationOutcome'),events:list(state,'automationEvent')};
}
