import { humanOwner, instant, insist, integer, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { addDays, localDate } from '../zone';
import { wallStart } from './series-model';
import { packServiceEligible, planBlock } from './pack-credits';
import { bookingPack, acknowledged } from './bookings';
import { windowOpen } from './booking-policy';
import { seatCapacity } from './spots';
import { studioSettings } from './studio';

export const leadStages = ['inquiry','intro-booked','first-visit','offer','membership','lost'] as const;
const open = (stage: string) => stage !== 'membership' && stage !== 'lost';
export const externalOutcomeLabel = 'Owner-recorded external outcome only';

/** Request identity is shared by all lead commands for this native actor. */
async function request(tx: Transaction, input: Record<string,unknown>, command: string) {
  humanOwner(tx.who);
  const requestId = text(input.requestId,'requestId',100);
  const basis = JSON.stringify(input,(_key,value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key,value[key]])) : value);
  const prior = list(tx.state,'leadEvent').find(e => e.actorId === tx.who.id && e.requestId === requestId);
  if (prior) {
    insist(prior.command === command && prior.requestBasis === basis,'lead_request_changed',409);
    return {requestId,basis,key:prior.id,prior:structuredClone(prior.after)};
  }
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([tx.who.id,requestId])));
  const key = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('');
  return {requestId,basis,key:`lead-event:${key}`,prior:null};
}

/** Assignment is a native active owner, fenced again in the atomic commit. */
async function assignment(tx: Transaction, value: unknown) {
  const ownerId = text(value,'ownerId',100);
  const owner = await tx.db.prepare("SELECT id,version FROM oa_operators WHERE id=? AND role='owner' AND status='active'")
    .bind(ownerId).first<{id:string;version:number}>();
  insist(owner,'active_native_owner_required',409);
  tx.sql.push(tx.statement("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND role='owner' AND status='active' AND version=?) THEN 1 ELSE 0 END",ownerId,owner.version));
  return ownerId;
}

function member(tx: Transaction, value: unknown) {
  const linked = person(tx.state,value,false);
  insist(linked.role === 'member','member_required');
  return linked.id;
}

function nextTask(input: Record<string,unknown>, stage: string, before?: RecordData) {
  if (!open(stage)) return {nextAction:null,dueAt:null};
  return {nextAction:text(input.nextAction ?? before?.nextAction,'nextAction',500),dueAt:instant(input.dueAt ?? before?.dueAt,'dueAt')};
}

function linkedBooking(tx: Transaction, personId: string, bookingId: unknown, attended: boolean) {
  const booking = record(tx.state,bookingId,'booking');
  insist(booking.personId === personId,'lead_booking_member_mismatch',409);
  insist(booking.status === 'booked','lead_confirmed_booking_required',409);
  if (attended) insist(booking.attendance === 'attended','lead_attended_booking_required',409);
  return booking.id;
}

function save(tx: Transaction, command: string, req: Awaited<ReturnType<typeof request>>, before: RecordData | null, after: RecordData, note: string | null) {
  // Events are insert-only, including replays; no command accepts an event id.
  insist(!tx.state.records.has(req.key),'lead_event_exists',409);
  const event = {id:req.key,leadId:after.id,personId:after.personId,command,requestId:req.requestId,requestBasis:req.basis,
    before:before ? structuredClone(before) : null,after:structuredClone(after),
    fromStage:before?.stage ?? null,toStage:after.stage,fromOwnerId:before?.ownerId ?? null,toOwnerId:after.ownerId,
    nextAction:after.nextAction,dueAt:after.dueAt,note,actorId:tx.who.id,actorRole:tx.who.role,at:after.updatedAt};
  tx.put('lead',after);
  tx.state.records.set(event.id,{kind:'leadEvent',data:event});
  tx.sql.push(tx.statement('INSERT INTO st_records(id,kind,data,version) VALUES(?,?,?,?)',event.id,'leadEvent',JSON.stringify(event),tx.state.version+1));
  return after;
}

/** LEAD-001 capture and identities remain separate: use an existing member. */
export async function createLead(tx: Transaction, input: Record<string,unknown>) {
  const req = await request(tx,input,'lead.create');
  if (req.prior) return req.prior;
  insist(input.id === undefined && input.version === undefined,'new_lead_required');
  insist(input.stage === undefined || input.stage === 'inquiry','new_lead_starts_at_inquiry');
  const personId = member(tx,input.personId), ownerId = await assignment(tx,input.ownerId);
  const at = now(), note = input.note === undefined ? null : text(input.note,'note',4000);
  const source = input.source === undefined || input.source === '' ? null : text(input.source,'source',100);
  const lead = {id:req.key.replace('lead-event:','lead:'),personId,ownerId,stage:'inquiry',version:1,
    source,
    ...nextTask(input,'inquiry'),bookingId:null,lostReason:null,externalMembershipReference:null,externalMembershipNote:null,externalOutcomeLabel:null,
    createdAt:at,createdBy:tx.who.id,updatedAt:at,updatedBy:tx.who.id};
  insist(!tx.state.records.has(lead.id),'lead_exists',409);
  return save(tx,'lead.create',req,null,lead,note);
}

export async function updateLead(tx: Transaction, input: Record<string,unknown>) {
  const req = await request(tx,input,'lead.update');
  if (req.prior) return req.prior;
  const before = record(tx.state,input.id,'lead');
  insist(before.version === integer(input.version,'version',1,Number.MAX_SAFE_INTEGER),'lead_changed',409);
  insist(input.personId === undefined || input.personId === before.personId,'lead_member_cannot_change');
  insist(input.source === undefined || input.source === before.source,'lead_source_cannot_change',409);
  member(tx,before.personId);
  const stage = text(input.stage ?? before.stage,'stage',30);
  insist((leadStages as readonly string[]).includes(stage),'invalid_lead_stage');
  const ownerId = await assignment(tx,input.ownerId ?? before.ownerId);
  let bookingId = before.bookingId;
  let lostReason: string | null = null;
  if (stage === 'intro-booked' || stage === 'first-visit') bookingId = linkedBooking(tx,before.personId,input.bookingId ?? bookingId,stage === 'first-visit');
  else insist(input.bookingId === undefined,'lead_booking_not_applicable');
  if (stage === 'lost') lostReason = text(input.lostReason ?? before.lostReason,'lostReason',1000);
  else insist(input.lostReason === undefined,'lead_lost_reason_not_applicable');
  const note = input.note === undefined ? null : text(input.note,'note',4000);
  let reference: string | null = null, membershipNote: string | null = null;
  if (stage === 'membership') {
    reference = text(input.externalMembershipReference ?? before.externalMembershipReference,'externalMembershipReference',200);
    membershipNote = note ?? before.externalMembershipNote;
    insist(membershipNote,'external_membership_note_required');
  } else insist(input.externalMembershipReference === undefined,'lead_membership_reference_not_applicable');
  const changedStage = stage !== before.stage;
  if (changedStage && open(stage)) { text(input.nextAction,'nextAction',500); instant(input.dueAt,'dueAt'); }
  const after = {...before,ownerId,stage,bookingId,lostReason,...nextTask(input,stage,before),
    externalMembershipReference:reference,externalMembershipNote:membershipNote,externalOutcomeLabel:stage === 'membership' ? externalOutcomeLabel : null,
    version:before.version+1,updatedAt:now(),updatedBy:tx.who.id};
  // PLAN-001/BILL-014 must replace this external outcome with native conversion
  // integration. This command grants no plan, entitlement, payment or consent.
  return save(tx,'lead.update',req,before,after,note);
}

export async function appendLeadNote(tx: Transaction, input: Record<string,unknown>) {
  const req = await request(tx,input,'lead.note');
  if (req.prior) return req.prior;
  const before = record(tx.state,input.id,'lead');
  insist(before.version === integer(input.version,'version',1,Number.MAX_SAFE_INTEGER),'lead_changed',409);
  const note = text(input.note,'note',4000);
  const after = {...before,version:before.version+1,updatedAt:now(),updatedBy:tx.who.id};
  return save(tx,'lead.note',req,before,after,note);
}

/** Human-owner private task queue and current-stage report; never agent data. */
export function leadSnapshot(state: State, who: Actor) {
  humanOwner(who);
  const asOf = now();
  const leads = list(state,'lead').map((lead): RecordData & {overdue:boolean} => ({...lead,overdue:open(lead.stage) && Date.parse(lead.dueAt) < Date.parse(asOf)}))
    .sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const queue = leads.filter(lead => open(lead.stage)).sort((a,b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
  const events = list(state,'leadEvent').sort((a,b) => a.at.localeCompare(b.at) || a.after.version-b.after.version || a.id.localeCompare(b.id));
  const stages = leadStages.map(stage => ({stage,count:leads.filter(lead => lead.stage === stage).length,overdue:leads.filter(lead => lead.stage === stage && lead.overdue).length}));
  return {asOf,leads,events,queue,overdue:queue.filter(lead => lead.overdue),stages,recoveryRule:state.records.get('recovery-rule')?.data ?? null,recoveryTasks:list(state,'recoveryTask')};
}

// Recovery uses studio-local weekly slots, not a duration since an arbitrary
// check-in. A future check-in cannot establish an elapsed routine.
export function saveRecoveryRule(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const previous = tx.state.records.get('recovery-rule')?.data;
  insist(integer(input.version ?? 0,'version',0) === (previous?.version ?? 0),'recovery_rule_changed',409);
  insist(typeof input.enabled === 'boolean','invalid_enabled');
  const saved = {id:'recovery-rule',enabled:input.enabled,minVisits:integer(input.minVisits,'minVisits',2,12),
    missedWeeks:integer(input.missedWeeks,'missedWeeks',1,12),lookbackWeeks:integer(input.lookbackWeeks,'lookbackWeeks',2,52),
    version:(previous?.version ?? 0)+1,updatedAt:now(),updatedBy:tx.who.id};
  insist(saved.lookbackWeeks >= saved.minVisits+saved.missedWeeks,'recovery_window_too_short');
  tx.put('recoveryRule',saved); tx.put('recoveryRuleRevision',{...saved,id:`recovery-rule:${saved.version}`}); return saved;
}

const serviceOf = (c: RecordData) => String(c.service ?? c.title).trim().toLowerCase();
const placeOf = (c: RecordData) => c.locationId ?? 'studio';
function weeklySlot(state: State, c: RecordData) {
  const zone = c.timeZone ?? studioSettings(state)?.timeZone ?? 'UTC';
  const date = localDate(c.start,zone);
  const time = new Intl.DateTimeFormat('en-GB',{timeZone:zone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).format(new Date(c.start));
  const weekday = new Date(date+'T12:00:00Z').getUTCDay();
  return {zone,date,time,key:JSON.stringify([serviceOf(c),placeOf(c),weekday,time,zone])};
}
function frozenAt(state: State, personId: string, at: string) {
  return list(state,'freeze').some(f => f.personId === personId && f.confirmedAt && !['withdrawn','declined'].includes(f.status) && f.startAt <= at && (!f.endAt || f.endAt > at));
}
function historicalEligibility(state: State, personId: string, c: RecordData) {
  return list(state,'pack').some(p => {
    if(p.personId !== personId || p.createdAt > c.start || p.expiresAt <= c.start || !packServiceEligible(p,c) || planBlock(state,p,c)) return false;
    if(p.entitlement && p.entitlement.kind !== 'credits') return true;
    const events = list(state,'packCreditEvent').filter(e => e.packId === p.id && e.createdAt <= c.start).sort((a,b)=>a.revision-b.revision);
    return (events.at(-1)?.remainingAfter ?? (p.creditLedgerVersion === 1 ? 0 : p.remaining)) > 0
      || list(state,'booking').some(b=>b.personId === personId && b.classId === c.id && b.packId === p.id && b.status === 'booked');
  });
}
/** A read-only explanation, shared by the refresh and task completion fences. */
export function recoveryEvidence(state: State) {
  const rule = state.records.get('recovery-rule')?.data, at = now();
  if(!rule?.enabled) return [];
  const classes = list(state,'class'), bookings = list(state,'booking'), results: RecordData[] = [];
  const since = new Date(Date.parse(at)-rule.lookbackWeeks*7*86400000).toISOString();
  for(const member of state.people.filter(p=>p.role === 'member' && p.active && !p.erasedAt)) {
    if(frozenAt(state,member.id,at)) continue;
    const attended = bookings.filter(b=>b.personId === member.id && b.status === 'booked' && b.attendance === 'attended')
      .map(b=>({b,c:classes.find(c=>c.id === b.classId)})).filter(({c})=>c && c.status === 'published' && c.end <= at && c.start >= since) as {b:RecordData;c:RecordData}[];
    const groups = new Map<string,{b:RecordData;c:RecordData}[]>();
    for(const visit of attended) {const key=weeklySlot(state,visit.c).key;groups.set(key,[...(groups.get(key) ?? []),visit]);}
    for(const [patternKey,visits] of groups) {
      visits.sort((a,b)=>a.c.start.localeCompare(b.c.start));
      const last = visits.at(-1)!, slot = weeklySlot(state,last.c);
      const pattern = Array.from({length:rule.minVisits},(_,i)=>visits.find(v=>weeklySlot(state,v.c).date === addDays(slot.date,-7*i)));
      if(pattern.some(v=>!v)) continue;
      const opportunities: {at:string;classIds:string[];bookingIds:string[]}[] = [], excluded: {at:string;reason:string}[] = [];
      // Inspect every elapsed expected slot after the last real visit. An absent
      // timetable is unavailable, never evidence that a member missed a class.
      for(let date=addDays(slot.date,7),n=0;n<rule.lookbackWeeks;date=addDays(date,7),n++) {
        const expected = new Date(wallStart(date,slot.time,slot.zone)).toISOString();
        if(expected >= at) break;
        const matches = classes.filter(c=>weeklySlot(state,c).key === patternKey && weeklySlot(state,c).date === date);
        if(frozenAt(state,member.id,expected)) {excluded.push({at:expected,reason:'membership_frozen'});continue;}
        const available = matches.filter(c=>c.status === 'published' && c.end <= at && historicalEligibility(state,member.id,c));
        if(!available.length) {excluded.push({at:expected,reason:matches.some(c=>c.status === 'cancelled') ? 'class_cancelled_or_holiday' : 'no_eligible_class'});continue;}
        const cancelled = bookings.some(b=>b.personId === member.id && available.some(c=>c.id === b.classId) && (b.status === 'cancelled' || b.attendance === 'excused'));
        if(cancelled) {excluded.push({at:expected,reason:'member_cancelled_or_excused'});continue;}
        // An unsettled booked visit is not an established absence until staff
        // marks no-show; an unbooked opportunity is an actual routine lapse.
        const own = bookings.filter(b=>b.personId === member.id && available.some(c=>c.id === b.classId));
        if(own.some(b=>b.attendance === 'attended' || (b.status === 'booked' && b.attendance !== 'no_show'))) continue;
        if(available.every(c=>!own.some(b=>b.classId === c.id && b.attendance === 'no_show') && seatCapacity(state,c).onlineOpen === 0)) {excluded.push({at:expected,reason:'class_full'});continue;}
        opportunities.push({at:expected,classIds:available.map(c=>c.id),bookingIds:own.filter(b=>b.attendance === 'no_show').map(b=>b.id)});
      }
      if(opportunities.length < rule.missedWeeks) continue;
      const alternatives = classes.filter(c=>c.status === 'published' && c.start > at && c.start < new Date(Date.parse(at)+14*86400000).toISOString()
        && serviceOf(c) === serviceOf(last.c) && !frozenAt(state,member.id,c.start) && acknowledged(state,member.id)
        && seatCapacity(state,c).onlineOpen > 0 && !bookings.some(b=>b.personId === member.id && b.classId === c.id && b.status !== 'cancelled'))
        .filter(c=>{const pack=bookingPack(state,member.id,c);return pack && windowOpen(state,c,pack);})
        .sort((a,b)=>a.start.localeCompare(b.start)).slice(0,5).map(c=>({classId:c.id,start:c.start,title:c.title}));
      results.push({id:member.id,personId:member.id,patternKey,lastBookingId:last.b.id,sourceBookingIds:pattern.map(v=>v!.b.id),
        opportunities,excluded,alternatives,ruleVersion:rule.version,asOf:at});
    }
  }
  return results;
}
export function processRecovery(tx: Transaction) {
  humanOwner(tx.who);
  const evidence = recoveryEvidence(tx.state), at = now();
  for(const task of list(tx.state,'recoveryTask').filter(t=>t.status === 'open')) {
    if(!evidence.some(e=>e.personId === task.personId && e.patternKey === task.patternKey && e.lastBookingId === task.lastBookingId))
      tx.put('recoveryTask',{...task,status:'suppressed',suppressedAt:at,suppressionReason:'routine_no_longer_justified'});
  }
  for(const e of evidence) {
    if(list(tx.state,'recoveryTask').some(t=>t.personId === e.personId && t.patternKey === e.patternKey && t.lastBookingId === e.lastBookingId)) continue;
    tx.put('recoveryTask',{...e,id:crypto.randomUUID(),status:'open',createdAt:at,createdBy:tx.who.id,
      nextAction:e.alternatives.length ? 'Review missed routine and offer one of the eligible alternatives' : 'Ask about availability; no eligible alternative is currently bookable'});
  }
  return {tasks:list(tx.state,'recoveryTask')};
}
export function completeRecovery(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const task = record(tx.state,input.id,'recoveryTask');
  const requestId = text(input.requestId,'requestId',100), note = text(input.note,'note',2000);
  if(task.status === 'completed') {insist(task.completionRequestId === requestId && task.note === note,'recovery_request_changed',409);return task;}
  insist(task.status === 'open' && recoveryEvidence(tx.state).some(e=>e.personId === task.personId && e.patternKey === task.patternKey && e.lastBookingId === task.lastBookingId),'recovery_no_longer_justified',409);
  const saved = {...task,status:'completed',completedAt:now(),completedBy:tx.who.id,completionRequestId:requestId,note};
  tx.put('recoveryTask',saved);return saved;
}
