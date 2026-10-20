import { humanOwner, id, insist, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { checkAllocations } from './classes';
import { schedulingConflicts } from './scheduling';
import { mailBasis, seriesBasis } from './series-model';
import { applyChangeNotices, changeImpact } from './series-effects';
import { mailNotConfigured, type NoticeContext } from './notices';
import { selectPayRule } from './teaching-pay';

const qualifications = (state: State) => list(state,'substitutionQualification');
function qualification(state: State, instructorId: string, service: unknown) {
  if (typeof service !== 'string' || !service.trim()) return undefined;
  return qualifications(state).filter(q => q.instructorId === instructorId && q.service === service.trim()).sort((a,b) => b.version-a.version)[0];
}
export const qualifiedForService = (state: State, instructorId: string, service: unknown) => !!qualification(state,instructorId,service)?.qualified;
function futureClass(state: State, classId: unknown) {
  const entry = record(state,classId,'class');
  insist(entry.status === 'published' && entry.start > now(),'substitution_class_must_be_future',409);
  return entry;
}
function replay(state: State, kind: string, actorId: string, requestId: string, requestBasis: string) {
  const prior = list(state,kind).find(r => r.createdBy === actorId && r.requestId === requestId);
  if (prior) insist(prior.requestBasis === requestBasis,'substitution_request_changed',409);
  return prior;
}
/** Studio approval for this exact service; this is not a certification claim. */
export function saveQualification(tx: Transaction, input: Record<string,unknown>) {
  humanOwner(tx.who);
  const instructorId = text(input.instructorId,'instructor_id',100), service = text(input.service,'service',160);
  insist(typeof input.qualified === 'boolean','invalid_qualified');
  const qualified = input.qualified, requestId = text(input.requestId,'request_id',100);
  const requestBasis = JSON.stringify({instructorId,service,qualified});
  const prior = replay(tx.state,'substitutionQualification',tx.who.id,requestId,requestBasis); if (prior) return prior;
  insist(person(tx.state,instructorId).role === 'instructor','instructor_required');
  const previous = qualification(tx.state,instructorId,service);
  const saved = {id:id(),instructorId,service,qualified,version:(previous?.version ?? 0)+1,requestId,requestBasis,createdAt:now(),createdBy:tx.who.id};
  tx.put('substitutionQualification',saved); return saved;
}
export function requestSubstitution(tx: Transaction, input: Record<string,unknown>) {
  insist(tx.who.role === 'owner' || tx.who.role === 'instructor','staff_required',403);
  if (tx.who.role === 'owner') humanOwner(tx.who);
  const classId = text(input.classId,'class_id',100), reason = text(input.reason,'reason',300), requestId = text(input.requestId,'request_id',100);
  const requestBasis = JSON.stringify({classId,reason});
  const prior = replay(tx.state,'substitutionRequest',tx.who.id,requestId,requestBasis); if (prior) return prior;
  const entry = futureClass(tx.state,classId);
  insist(tx.who.role === 'owner' || tx.who.personId === entry.instructorId,'assigned_instructor_required',403);
  insist(!list(tx.state,'substitutionRequest').some(r => r.classId === classId && r.status === 'requested'),'substitution_already_requested',409);
  tx.future(entry.start);
  const saved = {id:id(),classId,classTitle:entry.title,classStart:entry.start,originalInstructorId:entry.instructorId,originalInstructorName:entry.instructorName,reason,status:'requested',requestId,requestBasis,createdAt:now(),createdBy:tx.who.id,createdByRole:tx.who.role};
  tx.put('substitutionRequest',saved); return saved;
}
async function sourceBasis(state: State, request: RecordData) {
  return JSON.stringify({series:await seriesBasis(state),request,qualifications:qualifications(state).sort((a,b) => a.id.localeCompare(b.id)),
    payRules:list(state,'payRule').sort((a,b) => a.id.localeCompare(b.id)),mailConnection:state.records.get('member-mail')?.data ?? null});
}
function replacement(tx: Transaction, request: RecordData, instructorId: unknown) {
  insist(request.status === 'requested','substitution_request_closed',409);
  const before = futureClass(tx.state,request.classId), instructor = person(tx.state,text(instructorId,'instructor_id',100));
  insist(before.instructorId === request.originalInstructorId,'substitution_assignment_changed',409);
  insist(instructor.role === 'instructor' && instructor.id !== before.instructorId,'different_instructor_required');
  insist(qualification(tx.state,instructor.id,before.service)?.qualified,'substitution_qualification_required',409);
  const after = {...before,instructorId:instructor.id,instructorName:instructor.name,instructorVersion:instructor.version};
  checkAllocations(tx,[after],[before.id]);
  return {before,after};
}
export async function prepareSubstitution(tx: Transaction, input: Record<string,unknown>, context: NoticeContext = {}) {
  humanOwner(tx.who);
  const request = record(tx.state,input.requestId,'substitutionRequest'), {before,after} = replacement(tx,request,input.instructorId);
  const basis = await sourceBasis(tx.state,request), mail = mailBasis(context);
  const prior = list(tx.state,'substitutionDraft').find(d => d.status === 'draft' && d.requestId === request.id && d.instructorId === after.instructorId && d.basis === basis && d.mailBasis === mail);
  if (prior) return prior;
  const impact = {...changeImpact(tx.state,[before],[after]),key:id()};
  
  const rule = selectPayRule(tx.state,after);
  const draft = {id:id(),requestId:request.id,instructorId:after.instructorId,reason:request.reason,status:'draft',before,after,impact,basis,mailBasis:mail,
    pay:{ruleId:rule?.id ?? null,ruleVersion:rule?.version ?? null,rate:rule?.substitute ?? null,status:rule?.substitute ? 'configured' : 'unavailable'},
    email:context.mailConfigured ? 'configured; delivery outcome recorded after approval' : mailNotConfigured,createdAt:now(),createdBy:tx.who.id};
  tx.put('substitutionDraft',draft); return draft;
}
export async function approveSubstitution(tx: Transaction, input: Record<string,unknown>, context: NoticeContext = {}) {
  humanOwner(tx.who);
  const draft = record(tx.state,input.id,'substitutionDraft');
  insist(input.impact === draft.impact.key,'substitution_preview_changed',409);
  if (draft.status === 'approved') return draft;
  const request = record(tx.state,draft.requestId,'substitutionRequest');
  insist(draft.basis === await sourceBasis(tx.state,request) && draft.mailBasis === mailBasis(context),'substitution_facts_changed',409);
  const {before,after} = replacement(tx,request,draft.instructorId);
  changeImpact(tx.state,[before],[after]);
  const at = now(), provenance = {id:draft.id,requestId:request.id,originalInstructorId:before.instructorId,instructorId:after.instructorId,approvedAt:at,approvedBy:tx.who.id};
  const assigned = {...after,substitution:provenance,substitutionHistory:[...(before.substitutionHistory ?? []),provenance],updatedAt:at,updatedBy:tx.who.id};
  tx.put('class',assigned);
  applyChangeNotices(tx,draft,context);
  tx.put('substitutionRequest',{...request,status:'approved',draftId:draft.id,instructorId:after.instructorId,approvedAt:at,approvedBy:tx.who.id});
  const approved = {...draft,status:'approved',approvedAt:at,approvedBy:tx.who.id};
  tx.put('substitutionDraft',approved); return approved;
}
export function substitutionSnapshot(state: State, who: Actor) {
  const empty = {qualifications:[],requests:[],drafts:[],candidates:[]};
  if (who.role !== 'owner' && who.role !== 'instructor') return empty;
  const requests = list(state,'substitutionRequest').filter(r => who.role === 'owner' || r.originalInstructorId === who.personId);
  if (who.role !== 'owner') return {...empty,requests};
  const candidates = requests.filter(r => r.status === 'requested').flatMap(request => {
    const entry = state.records.get(request.classId)?.data;
    if (!entry || entry.status !== 'published' || entry.start <= now()) return [];
    return state.people.filter(p => p.role === 'instructor' && p.active && !p.erasedAt && p.id !== entry.instructorId).map(p => {
      const conflicts = schedulingConflicts([{...entry,instructorId:p.id,instructorName:p.name}],list(state,'class').filter(c => c.status !== 'cancelled' && c.id !== entry.id),list(state,'unavailability'));
      return {requestId:request.id,classId:entry.id,instructorId:p.id,instructorName:p.name,qualified:!!qualification(state,p.id,entry.service)?.qualified,available:conflicts.length === 0,conflicts};
    });
  });
  return {qualifications:qualifications(state),requests,drafts:list(state,'substitutionDraft'),candidates};
}
