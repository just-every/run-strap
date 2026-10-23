import { humanOwner, id, insist, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { memberRecordGrant, requireMemberRecord } from './member-records';
import { staffChannel, requestBasis } from './staff-actions';
import { classService } from './booking-policy';

const key = (s: string) => s.trim().replace(/\s+/g,' ').toLowerCase();
export const currentIntakeForms = (state: State) => list(state,'intakeSeries').map(s => record(state,s.currentFormId,'intakeForm'));
export function sensitiveIntakeAllowed(state: State,who: Actor,personId: string) {
  if(who.role === 'owner' && who.isOwner || who.role === 'member' && who.personId === personId) return true;
  const grant = state.records.get('intake-sensitive:'+who.personId)?.data, memberGrant = memberRecordGrant(state,who);
  return who.role === 'front-desk' && memberGrant?.enabled === true && memberGrant.memberIds.includes(personId) && grant?.enabled === true && grant.recordGrantVersion === memberGrant.version && grant.memberIds.includes(personId);
}
export function grantSensitiveIntake(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);text(input.requestId,'requestId',100);
  const staff = person(tx.state,input.personId), grant = memberRecordGrant(tx.state,{...tx.who,personId:staff.id});
  insist(grant?.enabled && staff.role === 'member','member_record_grant_required',409);
  insist(typeof input.enabled === 'boolean' && Array.isArray(input.memberIds) && input.memberIds.length <= 500,'invalid_sensitive_grant');
  const memberIds = [...new Set(input.memberIds.map(value => person(tx.state,value,false).id))].sort();
  insist(memberIds.every(m => grant.memberIds.includes(m)),'sensitive_scope_exceeds_member_records',403);
  const prior = tx.state.records.get('intake-sensitive:'+staff.id)?.data ?? null;
  const saved = {id:'intake-sensitive:'+staff.id,personId:staff.id,memberIds,recordGrantVersion:grant.version,enabled:input.enabled,at:now(),actorId:tx.who.id,before:prior ? {enabled:prior.enabled,memberIds:prior.memberIds}:null};
  tx.put('intakeSensitiveGrant',saved);
  tx.put('intakeSensitiveGrantEvent',{id:id(),personId:staff.id,actorId:tx.who.id,at:saved.at,before:prior?{enabled:prior.enabled,memberIds:prior.memberIds,recordGrantVersion:prior.recordGrantVersion}:null,after:{enabled:saved.enabled,memberIds:saved.memberIds,recordGrantVersion:saved.recordGrantVersion}});
  tx.sql.push(tx.statement('UPDATE oa_operators SET version=version+1 WHERE lower(email)=lower(?)',staff.email));
  return saved;
}
export function publishIntakeForm(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);text(input.requestId,'requestId',100);
  const prior = input.seriesId ? record(tx.state,input.seriesId,'intakeSeries') : null;
  if(prior) insist(input.revision === prior.revision,'intake_form_changed',409);
  insist(input.scope === 'signup' || input.scope === 'service','invalid_intake_scope');
  insist(typeof input.required === 'boolean','invalid_required');
  const service = input.scope === 'service' ? text(input.service,'service',160) : null;
  // A series keeps its purpose. Publish another series to cover a different service.
  if(prior) {const old = record(tx.state,prior.currentFormId,'intakeForm');insist(old.scope === input.scope && key(old.service ?? '') === key(service ?? ''),'intake_scope_immutable',409);}
  insist(Array.isArray(input.questions) && input.questions.length > 0 && input.questions.length <= 20,'invalid_questions');
  const questions = input.questions.map((q: any,i: number) => {insist(q && typeof q === 'object' && typeof q.required === 'boolean' && typeof q.sensitive === 'boolean','invalid_question');return {key:'q'+i,label:text(q.label,'question',300),required:q.required,sensitive:q.sensitive};});
  const formId=id(),seriesId=prior?.id ?? id(), version=(prior?.revision ?? 0)+1;
  const form = {id:formId,seriesId,version,title:text(input.title,'form_title',120),scope:input.scope,service,required:input.required,questions,at:now(),actorId:tx.who.id};
  tx.put('intakeForm',form);tx.put('intakeSeries',{id:seriesId,currentFormId:form.id,revision:version});return form;
}
export function intakeMissing(state: State,personId: string,services: string[] | null = null) {
  return currentIntakeForms(state).filter(f => f.required && (f.scope === 'signup' || services !== null && (services.length === 0 || services.some(s => key(s) === key(f.service)))))
    .filter(f => !list(state,'intakeResponse').some(r => r.personId === personId && r.formId === f.id && r.complete === true));
}
export function requireIntake(state: State,personId: string,services: string[] | null = null) {
  insist(intakeMissing(state,personId,services).length === 0,'intake_completion_required',409);
}
function target(tx: Transaction,input: Record<string,unknown>,staff: boolean) {
  const personId = staff ? input.personId : tx.who.personId;
  if(staff) requireMemberRecord(tx.state,tx.who,personId);
  else insist(tx.who.role === 'member' && (input.personId === undefined || input.personId === personId),'own_intake_required',403);
  const member=person(tx.state,personId);insist(member.role === 'member','member_required',403);return member;
}
export function authorizeIntakeSubmission(tx: Transaction,input: Record<string,unknown>) {
  const member=target(tx,input,true),form=record(tx.state,input.formId,'intakeForm');
  const answers=input.answers as Record<string,unknown> | undefined;
  if(answers && typeof answers === 'object') for(const q of form.questions) if(q.sensitive && answers[q.key] !== undefined && answers[q.key] !== '') insist(sensitiveIntakeAllowed(tx.state,tx.who,member.id),'sensitive_notes_right_required',403);
}
export function submitIntake(tx: Transaction,input: Record<string,unknown>,staff=false,tablet?: {id:string;personId:string;launchedBy:string}) {
  const member = tablet ? person(tx.state,tablet.personId) : target(tx,input,staff), form = record(tx.state,input.formId,'intakeForm');
  insist(record(tx.state,form.seriesId,'intakeSeries').currentFormId === form.id,'intake_form_changed',409);
  text(input.requestId,'requestId',100);
  insist(input.answers && typeof input.answers === 'object' && !Array.isArray(input.answers),'invalid_answers');
  const raw=input.answers as Record<string,unknown>;
  insist(Object.keys(raw).every(k => form.questions.some((q: RecordData) => q.key === k)),'unknown_intake_question');
  const channel = tablet ? 'desk-tablet' : staff ? staffChannel(input) : 'member-account';
  const actorId = tablet ? 'tablet:'+tablet.id : tx.who.id;
  const answers: Record<string,string> = {};
  for(const q of form.questions) {
    if(q.sensitive && !tablet && !sensitiveIntakeAllowed(tx.state,tx.who,member.id)) {insist(raw[q.key] === undefined || raw[q.key] === '','sensitive_notes_right_required',403);continue;}
    const answer = raw[q.key] === undefined ? '' : typeof raw[q.key] === 'string' ? (raw[q.key] as string).trim() : null;
    insist(answer !== null && answer.length <= 2000,'invalid_intake_answer');
    if(q.required) insist(answer.length > 0,'required_intake_answer');
    answers[q.key] = answer;
  }
  const basis = requestBasis({formId:form.id,answers,channel});
  const prior = list(tx.state,'intakeResponse').find(r => r.actorId === actorId && r.requestId === input.requestId);
  if(prior){insist(prior.requestBasis === basis && prior.personId === member.id,'intake_request_changed',409);return redactIntakeResponse(tx.state,tx.who,prior);}
  // Missing required sensitive answers cannot be bypassed by staff without that right.
  const previous = list(tx.state,'intakeResponse').filter(r => r.personId === member.id && r.formId === form.id).at(-1);
  const complete = form.questions.every((q: RecordData) => !q.required || !!answers[q.key] || !!previous?.answers[q.key]);
  const response = {id:id(),personId:member.id,formId:form.id,seriesId:form.seriesId,version:form.version,answers:{...(previous?.answers ?? {}),...answers},complete,
    at:now(),actorId,actorRole:tablet?'tablet-member':tx.who.role,staffMade:staff,channel,...(tablet?{tabletLaunchId:tablet.id,launchedBy:tablet.launchedBy}:{}),requestId:input.requestId,requestBasis:basis};
  tx.put('intakeResponse',response);return redactIntakeResponse(tx.state,tx.who,response);
}
export function redactIntakeResponse(state: State,who: Actor,response: RecordData) {
  const form=record(state,response.formId,'intakeForm'), sensitive=sensitiveIntakeAllowed(state,who,response.personId);
  return {...Object.fromEntries(Object.entries(response).filter(([k]) => k !== 'requestBasis')),answers:Object.fromEntries(Object.entries(response.answers).filter(([k]) => sensitive || !form.questions.find((q: RecordData) => q.key === k)?.sensitive))};
}
/** Current forms and their permitted original-version answers; instructors, agents and unrelated members get none. */
export function intakeSnapshot(state: State,who: Actor) {
  const owner=who.role === 'owner' && who.isOwner;
  const ids: string[]=owner ? state.people.filter(p => !p.erasedAt && p.role === 'member').map(p => p.id) : who.role === 'member' ? [who.personId!] : who.role === 'front-desk' ? memberRecordGrant(state,who)?.memberIds ?? [] : [];
  const forms=currentIntakeForms(state);
  const versions=list(state,'intakeForm').filter(f => owner || ids.length && list(state,'intakeResponse').some(r => ids.includes(r.personId) && r.formId === f.id));
  return {forms:owner || ids.length ? forms : [],versions,responses:list(state,'intakeResponse').filter(r => ids.includes(r.personId)).map(r => redactIntakeResponse(state,who,r)),
    sensitiveGrants:owner ? list(state,'intakeSensitiveGrant') : [],sensitiveGrantEvents:owner ? list(state,'intakeSensitiveGrantEvent') : [],sensitiveMemberIds:ids.filter(personId => sensitiveIntakeAllowed(state,who,personId)),
    missing:ids.flatMap(personId => intakeMissing(state,personId,[]).map(f => ({personId,formId:f.id,title:f.title,scope:f.scope,service:f.service})))};
}
/** Every existing enrollment door shares this fence, including future commands that create packs or seats. */
export function assertIntakeEnrollments(state: State,before: Map<string,string>) {
  for(const [key,row] of state.records) {
    if(row.kind === 'pack' && !before.has(key)) requireIntake(state,row.data.personId,row.data.eligibleServices ?? []);
    if(row.kind === 'booking' && ['booked','waitlisted','offered'].includes(row.data.status)) {
      const previous = before.get(key), next = JSON.stringify([row.data.classId,row.data.status]);
      if(previous !== next) requireIntake(state,row.data.personId,[classService(record(state,row.data.classId,'class'))]);
    }
  }
}
export const intakeEnrollmentBasis = (state: State) => new Map([...state.records].filter(([,row]) => row.kind === 'pack' || row.kind === 'booking').map(([key,row]) => [key,row.kind === 'pack' ? 'pack' : JSON.stringify([row.data.classId,row.data.status])]));
