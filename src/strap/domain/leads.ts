import { humanOwner, instant, insist, integer, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { addDays, localDate } from '../zone';
import { wallStart } from './series-model';
import { packServiceEligible, planBlock, appendPackEvent } from './pack-credits';
import { bookingPack, acknowledged, book } from './bookings';
import { windowOpen } from './booking-policy';
import { seatCapacity } from './spots';
import { studioSettings } from './studio';
import { permission as marketingPermission, preferencesOf } from './preferences';
import { promote } from './waitlist';
import { confirmBooking } from './notices';
import { contractNotice } from './contract-billing';
import { requireMemberRecord, memberRecordGrant } from './member-records';
import { staffChannel } from './staff-actions';
import { debtorOf } from './households';

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

/** An offer is an invitation, never a reservation ahead of the waitlist. */
export function emptyPlaceRefusal(state: State, personId: string, entry: RecordData) {
  const denied = marketingPermission(state,personId,'inApp');
  if(denied) return denied;
  if(!acknowledged(state,personId)) return 'waiver_acknowledgement_required';
  if(list(state,'booking').some(b=>b.personId === personId && b.classId === entry.id && b.status !== 'cancelled')) return 'already_booked_or_waiting';
  const preferences = preferencesOf(state,personId);
  if(preferences.preferredClasses && !String(preferences.preferredClasses).toLowerCase().split(/[,\n]/).map(s=>s.trim()).includes(serviceOf(entry))) return 'class_preference_mismatch';
  const pack = bookingPack(state,personId,entry);
  return !pack ? 'eligible_credit_required' : !windowOpen(state,entry,pack) ? 'booking_window_closed' : null;
}
export function prepareEmptyPlaces(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const entry=record(tx.state,input.classId,'class'),at=now();
  const leadMinutes=integer(input.leadMinutes,'leadMinutes',1,10080),maxPer30Days=integer(input.maxPer30Days,'maxPer30Days',1,30);
  insist(entry.status === 'published' && entry.start > at && Date.parse(entry.start)-Date.parse(at) <= leadMinutes*60000,'outside_outreach_window',409);
  insist(Array.isArray(input.personIds) && input.personIds.length > 0 && input.personIds.length <= 100,'invalid_audience');
  const personIds=[...new Set(input.personIds.map(value=>person(tx.state,value).id))];
  insist(personIds.every(id=>person(tx.state,id).role === 'member'),'member_required');
  const incentiveCents=integer(input.incentiveCents,'incentiveCents',0,100000),budgetCents=integer(input.budgetCents,'budgetCents',0,10000000);
  insist(incentiveCents <= budgetCents,'incentive_exceeds_budget');
  const since=new Date(Date.parse(at)-30*86400000).toISOString();
  const audience=personIds.map(personId=>({personId,reason:emptyPlaceRefusal(tx.state,personId,entry)
    ?? (list(tx.state,'emptyPlaceOffer').filter(o=>o.personId === personId && o.createdAt > since).length >= maxPer30Days ? 'frequency_cap' : null)}));
  const preview={id:crypto.randomUUID(),classId:entry.id,service:entry.service ?? entry.title,leadMinutes,maxPer30Days,incentiveCents,budgetCents,
    text:text(input.text,'offer_text',1000),audience,status:'preview',key:crypto.randomUUID(),version:tx.state.version+1,createdAt:at,createdBy:tx.who.id};
  tx.put('emptyPlaceCampaign',preview);return preview;
}
export function approveEmptyPlaces(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const campaign=record(tx.state,input.id,'emptyPlaceCampaign');
  insist(input.key === campaign.key,'outreach_preview_changed',409);
  if(campaign.status === 'approved') return campaign;
  insist(campaign.status === 'preview' && campaign.version === tx.state.version,'outreach_audience_changed',409);
  const entry=record(tx.state,campaign.classId,'class'),at=now();
  insist(entry.status === 'published' && entry.start > at,'class_already_started',409);tx.future(entry.start);
  // This is the normal waitlist policy, under the same serial revision fence.
  // Offers already held for waiters count against online capacity.
  promote(tx,entry);
  insist(seatCapacity(tx.state,entry).onlineOpen > 0,'waitlist_has_priority',409);
  const since=new Date(Date.parse(at)-30*86400000).toISOString();
  for(const row of campaign.audience.filter((r: {reason:string|null})=>!r.reason)) {
    insist(!emptyPlaceRefusal(tx.state,row.personId,entry),'outreach_eligibility_changed',409);
    insist(list(tx.state,'emptyPlaceOffer').filter(o=>o.personId === row.personId && o.createdAt > since).length < campaign.maxPer30Days,'outreach_frequency_changed',409);
    const offer={id:crypto.randomUUID(),campaignId:campaign.id,classId:entry.id,personId:row.personId,incentiveCents:campaign.incentiveCents,
      status:'offered',createdAt:at,expiresAt:entry.start,approvedBy:tx.who.id,text:campaign.text};
    tx.put('emptyPlaceOffer',offer);
    tx.put('memberMessage',{id:'empty-place-message:'+offer.id,personId:row.personId,text:`${campaign.text} ${entry.title}: ${entry.start}. Use an eligible plan credit. $${(offer.incentiveCents/100).toFixed(2)} studio-balance incentive only after attended class and owner review. Seats and budget are checked when accepted. Open Studio offers in Strap.`,at,actorId:tx.who.id,actorRole:'owner',channel:'in-app-marketing',emptyPlaceOfferId:offer.id});
  }
  const saved={...campaign,status:'approved',approvedAt:at,approvedBy:tx.who.id};tx.put('emptyPlaceCampaign',saved);return saved;
}
export function acceptEmptyPlace(tx: Transaction, input: Record<string,unknown>) {
  if(tx.who.role !== 'member')humanOwner(tx.who);
  const offer=record(tx.state,input.id,'emptyPlaceOffer');
  if(tx.who.role === 'member') insist(tx.who.personId === offer.personId,'emptyPlaceOffer_not_found',404);
  else humanOwner(tx.who);
  const requestId=text(input.requestId,'requestId',100);
  if(offer.status === 'accepted') {insist(offer.acceptedBy === tx.who.id && offer.requestId === requestId,'offer_already_accepted',409);return record(tx.state,offer.bookingId,'booking');}
  insist(offer.status === 'offered' && offer.expiresAt > now(),'empty_place_offer_closed',409);tx.future(offer.expiresAt);
  const campaign=record(tx.state,offer.campaignId,'emptyPlaceCampaign'),entry=record(tx.state,offer.classId,'class');
  const denied=emptyPlaceRefusal(tx.state,offer.personId,entry);insist(!denied,denied ?? 'outreach_ineligible',409);
  promote(tx,entry);
  // A waiter with a presently eligible pack cannot be bypassed even when the
  // studio's late-window policy deliberately stops automatic promotion.
  insist(!list(tx.state,'booking').some(b=>b.classId === entry.id && b.status === 'waitlisted' && acknowledged(tx.state,b.personId) && bookingPack(tx.state,b.personId,entry)),'waitlist_has_priority',409);
  insist(seatCapacity(tx.state,entry).onlineOpen > 0,'no_empty_seat',409);
  const reserved=list(tx.state,'emptyPlaceOffer').filter(o=>o.campaignId === campaign.id && o.status === 'accepted').reduce((sum,o)=>sum+o.incentiveCents,0);
  insist(reserved+offer.incentiveCents <= campaign.budgetCents,'outreach_budget_exhausted',409);
  const booking=book(tx,{classId:entry.id,...(input.spot ? {spot:input.spot} : {})},tx.who.role === 'owner' ? offer.personId : undefined);
  insist(booking.status === 'booked','no_empty_seat',409);
  confirmBooking(tx,booking);
  tx.put('emptyPlaceOffer',{...offer,status:'accepted',bookingId:booking.id,acceptedAt:now(),acceptedBy:tx.who.id,requestId,reservedCents:offer.incentiveCents});
  return booking;
}
export function settleEmptyPlace(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const offer=record(tx.state,input.id,'emptyPlaceOffer'),booking=record(tx.state,offer.bookingId,'booking'),entry=record(tx.state,offer.classId,'class');
  if(offer.rewardedAt)return offer;
  insist(offer.status === 'accepted' && booking.attendance === 'attended' && entry.end <= now(),'attended_class_required',409);tx.reached(entry.end);
  if(offer.incentiveCents)tx.put('charge',{id:'empty-place-incentive:'+offer.id,personId:offer.personId,bookingId:booking.id,amountCents:-offer.incentiveCents,reason:'empty_place_incentive',createdAt:now(),createdBy:tx.who.id});
  const saved={...offer,rewardedAt:now(),rewardedBy:tx.who.id,rewardCostCents:offer.incentiveCents};tx.put('emptyPlaceOffer',saved);return saved;
}
export function emptyPlaceSnapshot(state: State, who: Actor) {
  const owner=who.role === 'owner';
  return {campaigns:owner ? list(state,'emptyPlaceCampaign') : [],offers:list(state,'emptyPlaceOffer').filter(o=>owner || who.role === 'member' && o.personId === who.personId).map(o=>{
    const entry=state.records.get(o.classId)?.data;
    const reason=o.status === 'offered' ? o.expiresAt <= now() || entry?.status !== 'published' ? 'class_closed' : emptyPlaceRefusal(state,o.personId,entry!) : null;
    return {...o,available:!reason && o.status === 'offered',unavailableReason:reason};
  })};
}

/** Approved native finite-membership terms shared by lifecycle offers. */
function finiteTerms(input: Record<string,unknown>, services: string[]) {
  return {name:text(input.planName,'planName',80),days:integer(input.days,'days',1,366),amountCents:integer(input.amountCents,'amountCents',0,100000000),
    eligibleServices:services,locationId:'studio',eligibleLocations:['studio'],renewsAutomatically:false,collection:'studio-balance-only'};
}
function nativeMembership(state: State, personId: string, since: string) {
  return list(state,'pack').find(p=>p.personId === personId && !p.introSaleId && p.entitlement && p.createdAt >= since);
}
export function saveNurtureSequence(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const intro=record(tx.state,input.introOfferId,'introOffer');
  insist(intro.active,'intro_offer_closed',409);
  insist(!list(tx.state,'nurtureSequence').some(s=>s.introOfferId === intro.id && s.enabled),'nurture_sequence_already_active',409);
  const saved={id:crypto.randomUUID(),introOfferId:intro.id,enabled:true,welcome:text(input.welcome,'welcome',1500),guidance:text(input.guidance,'guidance',1500),
    offerText:text(input.offerText,'offerText',1000),terms:finiteTerms(input,intro.eligibleServices),approvedAt:now(),approvedBy:tx.who.id};
  tx.put('nurtureSequence',saved);return saved;
}
export function pauseNurtureSequence(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);const sequence=record(tx.state,input.id,'nurtureSequence');
  const saved={...sequence,enabled:false,pausedAt:now(),pausedBy:tx.who.id};tx.put('nurtureSequence',saved);return saved;
}
function nurtureStopReason(state: State, enrollment: RecordData) {
  const sale=state.records.get(enrollment.introSaleId)?.data,sequence=state.records.get(enrollment.sequenceId)?.data;
  if(!sale || sale.expiresAt <= now())return 'intro_expired';
  if(!sequence?.enabled)return 'sequence_paused';
  if(marketingPermission(state,enrollment.personId,'inApp'))return 'marketing_permission_withdrawn';
  if(nativeMembership(state,enrollment.personId,sale.createdAt))return 'membership_purchased';
  if(list(state,'memberMessage').some(m=>m.personId === enrollment.personId && m.actorRole === 'member' && m.at >= sale.createdAt))return 'member_replied';
  return null;
}
function introVisit(state: State, enrollment: RecordData) {
  const sale=state.records.get(enrollment.introSaleId)?.data;
  return sale && list(state,'booking').filter(b=>b.personId === enrollment.personId && b.packId === sale.packId && b.status === 'booked' && b.attendance === 'attended')
    .find(b=>{const c=state.records.get(b.classId)?.data;return c?.status === 'published' && c.end <= now();});
}
/** Suppression runs after every command and scheduler pass. It never sends or
 * enrolls anyone; a native owner explicitly reviews every delivery batch. */
export function suppressNurture(tx: Transaction) {
  for(const enrollment of list(tx.state,'nurtureEnrollment').filter(e=>e.status === 'active')) {
    const reason=nurtureStopReason(tx.state,enrollment);if(!reason)continue;
    tx.put('nurtureEnrollment',{...enrollment,status:'stopped',stopReason:reason,stoppedAt:now()});
    for(const task of list(tx.state,'nurtureTask').filter(t=>t.enrollmentId === enrollment.id && t.status === 'open'))tx.put('nurtureTask',{...task,status:'stopped',stopReason:reason,stoppedAt:now()});
  }
  for(const offer of list(tx.state,'nurtureOffer').filter(o=>o.status === 'offered')) {
    const enrollment=tx.state.records.get(offer.enrollmentId)?.data;
    const reason=!enrollment || enrollment.status !== 'active' ? enrollment?.stopReason ?? 'enrollment_stopped' : !introVisit(tx.state,enrollment) ? 'attendance_corrected' : nurtureStopReason(tx.state,enrollment);
    if(reason)tx.put('nurtureOffer',{...offer,status:'suppressed',suppressionReason:reason,suppressedAt:now()});
  }
}
export function reviewNurture(tx: Transaction) {
  humanOwner(tx.who);suppressNurture(tx);
  for(const sale of list(tx.state,'introSale')) {
    const sequence=list(tx.state,'nurtureSequence').find(s=>s.introOfferId === sale.offerId && s.enabled);
    if(!sequence)continue;
    let enrollment=list(tx.state,'nurtureEnrollment').find(e=>e.introSaleId === sale.id);
    if(!enrollment) {
      const candidate={id:crypto.randomUUID(),personId:sale.personId,introSaleId:sale.id,sequenceId:sequence.id,status:'active',createdAt:now(),reviewedBy:tx.who.id};
      const reason=nurtureStopReason(tx.state,candidate);
      enrollment=reason ? {...candidate,status:'stopped',stopReason:reason,stoppedAt:now()} : candidate;
      tx.put('nurtureEnrollment',enrollment);
    }
    if(enrollment.status !== 'active')continue;
    for(const [step,message] of [['welcome',sequence.welcome],['first-visit-guidance',sequence.guidance]]) {
      const key=`nurture-message:${enrollment.id}:${step}`;
      if(!tx.state.records.has(key))tx.put('memberMessage',{id:key,personId:sale.personId,nurtureEnrollmentId:enrollment.id,step,text:message,
        introSaleId:sale.id,at:now(),actorId:tx.who.id,actorRole:'owner',channel:'in-app-marketing'});
    }
    const taskId='nurture-task:'+enrollment.id;
    if(!tx.state.records.has(taskId))tx.put('nurtureTask',{id:taskId,enrollmentId:enrollment.id,personId:sale.personId,introSaleId:sale.id,status:'open',nextAction:'Review the member’s first-class preparation and questions',createdAt:now(),createdBy:tx.who.id});
    const visit=introVisit(tx.state,enrollment);
    if(visit && !list(tx.state,'nurtureOffer').some(o=>o.enrollmentId === enrollment!.id)) {
      const offer={id:crypto.randomUUID(),personId:sale.personId,enrollmentId:enrollment.id,introSaleId:sale.id,bookingId:visit.id,sequenceId:sequence.id,
        terms:sequence.terms,text:sequence.offerText,key:crypto.randomUUID(),status:'offered',createdAt:now(),approvedBy:sequence.approvedBy,reviewedBy:tx.who.id,expiresAt:sale.expiresAt};
      tx.put('nurtureOffer',offer);
      tx.put('memberMessage',{id:'nurture-offer-message:'+offer.id,personId:sale.personId,nurtureEnrollmentId:enrollment.id,nurtureOfferId:offer.id,step:'membership-offer',text:offer.text,at:now(),actorId:tx.who.id,actorRole:'owner',channel:'in-app-marketing'});
    }
  }
  return {enrollments:list(tx.state,'nurtureEnrollment'),tasks:list(tx.state,'nurtureTask'),offers:list(tx.state,'nurtureOffer')};
}
function purchaseFiniteMembership(tx: Transaction, offer: RecordData, kind: string) {
  const at=now(),terms=offer.terms,pack={id:'membership:'+offer.id,personId:offer.personId,amountCents:terms.amountCents,
    ...{locationId:terms.locationId,eligibleLocations:terms.eligibleLocations,eligibleServices:terms.eligibleServices},
    entitlement:{kind:'unlimited',name:terms.name,visits:null,period:null,rollover:0,days:null,from:null,to:null,maxUpcoming:null},
    credits:0,remaining:0,creditLedgerVersion:1,creditRevision:0,termStartAt:at,expiresAt:new Date(Date.parse(at)+terms.days*86400000).toISOString(),
    lifecycleOfferId:offer.id,lifecycleKind:kind,createdAt:at};
  tx.put('pack',pack);appendPackEvent(tx,pack,{type:'grant',credits:0});
  const debtor=debtorOf(tx.state,offer.personId);
  tx.put('charge',{id:'membership-charge:'+offer.id,personId:debtor,...(debtor !== offer.personId ? {forPersonId:offer.personId} : {}),packId:pack.id,amountCents:terms.amountCents,reason:kind+'_membership',createdAt:at,createdBy:tx.who.id});
  tx.put(kind+'Offer',{...offer,status:'purchased',packId:pack.id,purchasedAt:at,purchasedBy:tx.who.id});
  contractNotice(tx,'membership-notice:'+offer.id,offer.personId,'Finite membership purchased',`${terms.name}: unlimited eligible visits for ${terms.days} days, $${(terms.amountCents/100).toFixed(2)} added to ${debtor === offer.personId ? 'your studio balance' : 'the studio balance of your previously accepted household payer'}. Valid at the studio location for ${terms.eligibleServices.join(', ') || 'all services'}. No payment collected, stored method, automatic renewal or future invoice agreement. Ends ${pack.expiresAt}.`);
  return record(tx.state,pack.id,'pack');
}
export function purchaseNurture(tx: Transaction, input: Record<string,unknown>) {
  if(tx.who.role !== 'member')humanOwner(tx.who);
  const offer=record(tx.state,input.id,'nurtureOffer');
  if(tx.who.role === 'member')insist(offer.personId === tx.who.personId,'nurtureOffer_not_found',404);
  person(tx.state,offer.personId);
  insist(input.confirm === true && input.key === offer.key,'exact_membership_confirmation_required',409);
  text(input.requestId,'requestId',100);
  if(offer.status === 'purchased')return record(tx.state,offer.packId,'pack');
  const enrollment=record(tx.state,offer.enrollmentId,'nurtureEnrollment');
  insist(offer.status === 'offered' && enrollment.status === 'active' && !nurtureStopReason(tx.state,enrollment) && introVisit(tx.state,enrollment),'nurture_offer_no_longer_eligible',409);
  tx.future(offer.expiresAt);
  return purchaseFiniteMembership(tx,offer,'nurture');
}
export function nurtureSnapshot(state: State, who: Actor) {
  const owner=who.role === 'owner',visible=(r:RecordData)=>owner || who.role === 'member' && r.personId === who.personId;
  return {sequences:owner ? list(state,'nurtureSequence') : [],enrollments:list(state,'nurtureEnrollment').filter(visible),offers:list(state,'nurtureOffer').filter(visible),tasks:owner ? list(state,'nurtureTask') : [],
    messages:list(state,'memberMessage').filter(m=>m.nurtureEnrollmentId && visible(m))};
}

function safeReferral(referral: RecordData) {
  // The submitted address is already known to the referrer; matching, purchase
  // and reward records never disclose another member's identity or activity.
  return {id:referral.id,personId:referral.personId,friendEmail:referral.friendEmail,createdAt:referral.createdAt,source:referral.source,attribution:'received_for_owner_review'};
}
export function recordReferral(tx: Transaction, input: Record<string,unknown>) {
  const self=tx.who.role === 'member';
  if(self)insist(input.personId === undefined || input.personId === tx.who.personId,'own_referral_required',403);
  else requireMemberRecord(tx.state,tx.who,input.personId);
  const referrer=person(tx.state,self ? tx.who.personId : input.personId);insist(referrer.role === 'member','member_required');
  const friendEmail=text(input.friendEmail,'friendEmail',254).toLowerCase();insist(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(friendEmail),'invalid_friendEmail');
  insist(friendEmail !== referrer.email?.toLowerCase(),'cannot_refer_self');
  const requestId=text(input.requestId,'requestId',100),source=self ? 'signed-in-member' : 'staff-'+staffChannel(input);
  const basis=JSON.stringify({personId:referrer.id,friendEmail,source,sourceReference:input.sourceReference ?? null});
  const event=list(tx.state,'referralEvent').find(e=>e.actorId === tx.who.id && e.requestId === requestId);
  if(event) {insist(event.requestBasis === basis,'referral_request_changed',409);return tx.who.role === 'owner' ? event.after : safeReferral(event.after);}
  const prior=list(tx.state,'referral').find(r=>r.personId === referrer.id && r.friendEmail === friendEmail);
  const friend=tx.state.people.find(p=>p.role === 'member' && !p.erasedAt && p.email?.toLowerCase() === friendEmail);
  const verified=!self && !!friend,reference=self ? null : text(input.sourceReference,'sourceReference',500);
  if(verified)insist(!list(tx.state,'referral').some(r=>r.id !== prior?.id && r.referredPersonId === friend!.id && r.verifiedAt),'referral_already_attributed',409);
  const saved={...(prior ?? {}),id:prior?.id ?? crypto.randomUUID(),personId:referrer.id,friendEmail,referredPersonId:verified ? friend!.id : prior?.referredPersonId ?? null,
    status:verified || prior?.verifiedAt ? 'verified' : 'pending',verifiedAt:prior?.verifiedAt ?? (verified ? now() : null),verifiedBy:prior?.verifiedBy ?? (verified ? tx.who.id : null),
    source:prior?.source ?? source,createdAt:prior?.createdAt ?? now(),createdBy:prior?.createdBy ?? tx.who.id,sourceReference:reference ?? prior?.sourceReference ?? null};
  tx.put('referral',saved);tx.put('referralEvent',{id:crypto.randomUUID(),personId:referrer.id,referralId:saved.id,before:prior ?? null,after:structuredClone(saved),actorId:tx.who.id,actorRole:tx.who.role,source,at:now(),requestId,requestBasis:basis});
  return tx.who.role === 'owner' ? saved : safeReferral(saved);
}
function winbackEvidence(state: State, personId: string, cadenceDays: number) {
  const at=now(),member=state.people.find(p=>p.id === personId && p.role === 'member' && p.active && !p.erasedAt);
  const packs=list(state,'pack').filter(p=>p.personId === personId),cancellations=list(state,'contractCancellation').filter(c=>c.personId === personId && ['scheduled','applied'].includes(c.status) && c.effectiveAt <= at);
  const ended=packs.filter(p=>p.expiresAt <= at || cancellations.some(c=>c.packId === p.id));
  const active=packs.some(p=>p.expiresAt > at && !cancellations.some(c=>c.packId === p.id));
  const since=new Date(Date.parse(at)-cadenceDays*86400000).toISOString();
  const recent=list(state,'winbackOffer').some(o=>o.personId === personId && o.createdAt > since);
  const reason=!member ? 'member_inactive' : marketingPermission(state,personId,'inApp') ? 'marketing_permission_withdrawn' : active ? 'active_membership' : !ended.length ? 'no_former_membership' : frozenAt(state,personId,at) ? 'membership_frozen' : recent ? 'cadence_cap' : null;
  return {personId,packIds:ended.map(p=>p.id),cancellationIds:cancellations.map(c=>c.id),reason};
}
export function prepareWinback(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  insist(Array.isArray(input.personIds) && input.personIds.length > 0 && input.personIds.length <= 100,'invalid_audience');
  const personIds=[...new Set(input.personIds.map(value=>person(tx.state,value,false).id))],cadenceDays=integer(input.cadenceDays,'cadenceDays',1,3650);
  const services=input.eligibleServices ?? [];insist(Array.isArray(services) && services.length <= 100,'invalid_eligibleServices');
  const rewardCents=integer(input.rewardCents,'rewardCents',0,100000),budgetCents=integer(input.budgetCents,'budgetCents',0,10000000);insist(rewardCents <= budgetCents,'reward_exceeds_budget');
  const saved={id:crypto.randomUUID(),terms:finiteTerms(input,services.map(s=>text(s,'service',160))),cadenceDays,rewardCents,budgetCents,
    offerDays:integer(input.offerDays,'offerDays',1,30),text:text(input.text,'offer_text',1000),audience:personIds.map(id=>winbackEvidence(tx.state,id,cadenceDays)),
    status:'preview',key:crypto.randomUUID(),version:tx.state.version+1,createdAt:now(),createdBy:tx.who.id};
  tx.put('winbackCampaign',saved);return saved;
}
export function approveWinback(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);const campaign=record(tx.state,input.id,'winbackCampaign');
  insist(input.key === campaign.key,'winback_preview_changed',409);if(campaign.status === 'approved')return campaign;
  insist(campaign.version === tx.state.version && campaign.status === 'preview','winback_audience_changed',409);
  const at=now();
  for(const row of campaign.audience.filter((r:{reason:string|null})=>!r.reason)) {
    insist(!winbackEvidence(tx.state,row.personId,campaign.cadenceDays).reason,'winback_eligibility_changed',409);
    const offer={id:crypto.randomUUID(),campaignId:campaign.id,personId:row.personId,terms:campaign.terms,text:campaign.text,sourcePackIds:row.packIds,sourceCancellationIds:row.cancellationIds,
      status:'offered',key:crypto.randomUUID(),createdAt:at,approvedBy:tx.who.id,expiresAt:new Date(Date.parse(at)+campaign.offerDays*86400000).toISOString()};
    tx.put('winbackOffer',offer);
    tx.put('memberMessage',{id:'winback-message:'+offer.id,personId:row.personId,winbackOfferId:offer.id,text:campaign.text,at,actorId:tx.who.id,actorRole:'owner',channel:'in-app-marketing'});
  }
  const saved={...campaign,status:'approved',approvedAt:at,approvedBy:tx.who.id};tx.put('winbackCampaign',saved);return saved;
}
function winbackStopReason(state: State, offer: RecordData) {
  if(offer.expiresAt <= now())return 'offer_expired';
  if(marketingPermission(state,offer.personId,'inApp'))return 'marketing_permission_withdrawn';
  const cancellations=list(state,'contractCancellation').filter(c=>c.personId === offer.personId && ['scheduled','applied'].includes(c.status) && c.effectiveAt <= now());
  if(list(state,'pack').some(p=>p.personId === offer.personId && p.expiresAt > now() && !cancellations.some(c=>c.packId === p.id)))return 'membership_renewed';
  return frozenAt(state,offer.personId,now()) ? 'membership_frozen' : null;
}
export function suppressWinback(tx: Transaction) {
  for(const offer of list(tx.state,'winbackOffer').filter(o=>o.status === 'offered')) {
    const reason=winbackStopReason(tx.state,offer);if(reason)tx.put('winbackOffer',{...offer,status:'suppressed',suppressionReason:reason,suppressedAt:now()});
  }
}
export function purchaseWinback(tx: Transaction, input: Record<string,unknown>) {
  if(tx.who.role !== 'member')humanOwner(tx.who);
  const offer=record(tx.state,input.id,'winbackOffer');if(tx.who.role === 'member')insist(offer.personId === tx.who.personId,'winbackOffer_not_found',404);
  person(tx.state,offer.personId);insist(input.confirm === true && input.key === offer.key,'exact_membership_confirmation_required',409);text(input.requestId,'requestId',100);
  if(offer.status === 'purchased')return record(tx.state,offer.packId,'pack');
  insist(offer.status === 'offered' && !winbackStopReason(tx.state,offer),'winback_offer_no_longer_eligible',409);tx.future(offer.expiresAt);
  const campaign=record(tx.state,offer.campaignId,'winbackCampaign'),referral=list(tx.state,'referral').find(r=>r.referredPersonId === offer.personId && r.verifiedAt && !r.rewardReservedByOfferId);
  const rewardCents=referral ? campaign.rewardCents : 0,reserved=list(tx.state,'winbackOffer').filter(o=>o.campaignId === campaign.id && o.status === 'purchased').reduce((sum,o)=>sum+(o.reservedRewardCents ?? 0),0);
  insist(reserved+rewardCents <= campaign.budgetCents,'referral_reward_budget_exhausted',409);
  const pack=purchaseFiniteMembership(tx,offer,'winback');
  const purchased=record(tx.state,offer.id,'winbackOffer');tx.put('winbackOffer',{...purchased,referralId:referral?.id ?? null,referrerId:referral?.personId ?? null,reservedRewardCents:rewardCents});
  if(referral)tx.put('referral',{...referral,rewardReservedByOfferId:offer.id,rewardReservedAt:now()});
  return pack;
}
function laterVisits(state: State, offer: RecordData) {
  return list(state,'booking').filter(b=>b.personId === offer.personId && b.packId === offer.packId && b.status === 'booked' && b.attendance === 'attended')
    .filter(b=>{const c=state.records.get(b.classId)?.data;return c?.status === 'published' && c.end <= now();});
}
export function reviewReferralReward(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);const offer=record(tx.state,input.id,'winbackOffer');
  if(offer.rewardedAt)return offer;
  const visits=laterVisits(tx.state,offer);insist(offer.status === 'purchased' && offer.referralId && offer.referrerId && visits.length,'renewed_attendance_required',409);
  const referral=record(tx.state,offer.referralId,'referral');insist(referral.rewardReservedByOfferId === offer.id,'referral_reward_changed',409);person(tx.state,offer.referrerId);
  if(offer.reservedRewardCents)tx.put('charge',{id:'referral-reward:'+offer.id,personId:offer.referrerId,amountCents:-offer.reservedRewardCents,reason:'referral_reward',createdAt:now(),createdBy:tx.who.id});
  const saved={...offer,rewardedAt:now(),rewardedBy:tx.who.id,rewardCostCents:offer.reservedRewardCents,rewardBookingIds:visits.map(b=>b.id)};tx.put('winbackOffer',saved);return saved;
}
export function winbackSnapshot(state: State, who: Actor) {
  const owner=who.role === 'owner';
  const all=list(state,'winbackOffer');
  return {campaigns:owner ? list(state,'winbackCampaign') : [],offers:all.filter(o=>owner || who.role === 'member' && o.personId === who.personId).map(o=>{
    if(owner)return {...o,laterAttendedBookingIds:o.status === 'purchased' ? laterVisits(state,o).map(b=>b.id) : []};
    const {referralId,referrerId,reservedRewardCents,rewardedAt,rewardedBy,rewardCostCents,rewardBookingIds,...safe}=o;return safe;
  }),referrals:list(state,'referral').filter(r=>owner || who.role === 'member' && r.personId === who.personId || who.role === 'front-desk' && memberRecordGrant(state,who)?.memberIds.includes(r.personId)).map(r=>owner ? r : safeReferral(r)),
    totals:owner ? {redemptions:all.filter(o=>o.status === 'purchased').length,reservedCents:all.reduce((sum,o)=>sum+(o.reservedRewardCents ?? 0),0),rewardCostCents:all.reduce((sum,o)=>sum+(o.rewardCostCents ?? 0),0),laterVisits:all.filter(o=>o.status === 'purchased').reduce((sum,o)=>sum+laterVisits(state,o).length,0)} : null};
}
