import { humanOwner, instant, insist, integer, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';

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
  const lead = {id:req.key.replace('lead-event:','lead:'),personId,ownerId,stage:'inquiry',version:1,
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
  return {asOf,leads,events,queue,overdue:queue.filter(lead => lead.overdue),stages};
}
