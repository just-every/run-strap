import { acknowledged } from './bookings';
import { requireIntake } from './intake';
import { humanOwner, id, insist, integer, instant, list, now, person, record, text, type Actor, type RecordData, type State } from './types';
import type { Transaction } from './store';
import { debtorOf } from './households';
import { hasStaffRight, requireStaffRight } from './staff-rights';
import { locationById } from './locations';
import { putNotice } from './notices';

const policy = 'Deposit and received tuition are retained. Withdrawal releases remaining seats and credits only unpaid installments whose due time has not passed. Overdue debt remains owed. A missed installment flags the roster for owner review; it never charges, withdraws or sends a message automatically.';
const enrollments = (s: State, courseId: string) => list(s,'courseEnrollment').filter(e=>e.courseId===courseId);
function courseFor(s: State, input: Record<string,unknown>) {
  return record(s,input.courseId,'course');
}
export function authorizeCourse(tx: Transaction, name: string, input: Record<string,unknown>) {
  const right = name.includes('withdraw') ? 'contract-change' : 'sale';
  requireStaffRight(tx.state,tx.who,right);
  const preparing=name==='course.enrollment.prepare';
  const target=!preparing && input.id ? tx.state.records.get(String(input.id))?.data : null;
  const c=record(tx.state,preparing ? input.courseId : target?.courseId,'course');
  const participantId=String(preparing ? input.personId ?? '' : target?.personId ?? '');
  insist(participantId,'staff_scope_required',403);
  requireStaffRight(tx.state,tx.who,right,participantId,c.locationId);
}
export function publishCourse(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);
  const location=locationById(tx.state,input.locationId ?? 'studio');
  insist(Array.isArray(input.sessions) && input.sessions.length>0 && input.sessions.length<=104,'invalid_course_sessions');
  const sessions=input.sessions.map((r: any,i: number)=>{
    const start=instant(r.start,'session_start'),end=instant(r.end,'session_end');
    insist(start>now() && end>start,'invalid_course_session');tx.future(start);
    return {id:String(i+1),start,end};
  }).sort((a,b)=>a.start.localeCompare(b.start));
  insist(sessions.every((r,i)=>!i || sessions[i-1].end<=r.start),'course_sessions_overlap');
  const depositCents=integer(input.depositCents,'depositCents',0,100_000_000);
  insist(Array.isArray(input.installments) && input.installments.length>0 && input.installments.length<=24,'invalid_installments');
  const installments=input.installments.map((r: any,i: number)=>({id:String(i+1),dueAt:instant(r.dueAt,'dueAt'),amountCents:integer(r.amountCents,'amountCents',1,100_000_000)})).sort((a,b)=>a.dueAt.localeCompare(b.dueAt));
  insist(installments.every(r=>r.dueAt>now() && r.dueAt<=sessions.at(-1)!.end),'invalid_installment_due_time');
  const amountCents=depositCents+installments.reduce((sum,r)=>sum+r.amountCents,0);integer(amountCents,'tuition',1,100_000_000);
  insist(input.confirmPolicy===true,'course_policy_confirmation_required');
  const c={id:id(),name:text(input.name,'course_name',120),locationId:location.id,timeZone:location.timeZone,capacity:integer(input.capacity,'capacity',1,500),sessions,depositCents,installments,amountCents,policy,createdAt:now(),createdBy:tx.who.id};
  tx.put('course',c);return c;
}
function payerBasis(s: State, participantId: string) {
  const payerId=debtorOf(s,participantId),payer=person(s,payerId);
  insist(payer.email && payer.role==='member','course_payer_sign_in_required');
  const household=list(s,'household').find(h=>h.participantIds.includes(participantId));
  return {payerId,household:household ? {id:household.id,revision:household.revision,payerId:household.payerId} : null};
}
export function prepareEnrollment(tx: Transaction,input: Record<string,unknown>) {
  authorizeCourse(tx,'course.enrollment.prepare',input);
  const c=courseFor(tx.state,input),participant=person(tx.state,input.personId);
  insist(participant.role==='member','member_required');
  insist(c.sessions[0].start>now(),'course_already_started',409);tx.future(c.sessions[0].start);
  insist(!enrollments(tx.state,c.id).some(e=>e.personId===participant.id),'course_already_enrolled',409);
  const basis=payerBasis(tx.state,participant.id);
  const preview={id:id(),courseId:c.id,personId:participant.id,participantName:participant.name,payerId:basis.payerId,payerBasis:JSON.stringify(basis),key:id(),status:'preview',amountCents:c.amountCents,depositCents:c.depositCents,installments:c.installments,policy:c.policy,seatEffect:'One seat in every session; enrollment completes only after the payer personally accepts and staff confirms.',createdAt:now(),createdBy:tx.who.id};
  tx.put('courseEnrollmentPreview',preview);return preview;
}
export function launchCourseAcceptance(tx: Transaction,input: Record<string,unknown>) {
  authorizeCourse(tx,'course.enrollment.launch',input);
  const preview=record(tx.state,input.id,'courseEnrollmentPreview');
  insist(preview.status==='preview','course_preview_closed',409);
  return {id:preview.id,courseId:preview.courseId,personId:preview.personId,payerId:preview.payerId,status:'member_action_required',url:'/app/courses#review-'+preview.id};
}
export function acceptCourse(tx: Transaction,input: Record<string,unknown>) {
  insist(tx.who.role==='member','payer_acceptance_required',403);
  const p=record(tx.state,input.id,'courseEnrollmentPreview');
  insist(tx.who.personId===p.payerId,'courseEnrollmentPreview_not_found',404);
  insist(input.key===p.key && input.confirm===true,'course_exact_acceptance_required',409);
  insist(JSON.stringify(payerBasis(tx.state,p.personId))===p.payerBasis,'course_payer_changed',409);
  const c=record(tx.state,p.courseId,'course');insist(c.sessions[0].start>now(),'course_already_started',409);tx.future(c.sessions[0].start);
  if(p.acceptedAt)return p;
  insist(p.status==='preview','course_preview_closed',409);
  const accepted={...p,acceptedAt:now(),acceptedBy:tx.who.id};tx.put('courseEnrollmentPreview',accepted);return accepted;
}
function notice(tx: Transaction,e: RecordData,action: string,body: string) {
  for(const personId of new Set([e.personId,e.payerId])) putNotice(tx,{id:'notice:course:'+action+':'+e.id,personId,courseId:e.courseId,subject:'Course '+action,body},true);
}
export function confirmEnrollment(tx: Transaction,input: Record<string,unknown>) {
  authorizeCourse(tx,'course.enrollment.confirm',input);
  const p=record(tx.state,input.id,'courseEnrollmentPreview'),c=record(tx.state,p.courseId,'course');
  insist(input.key===p.key && input.confirm===true,'course_exact_confirmation_required',409);
  if(p.enrollmentId)return record(tx.state,p.enrollmentId,'courseEnrollment');
  insist(p.acceptedAt,'course_payer_acceptance_required',409);
  insist(acknowledged(tx.state,p.personId,{id:c.id,service:c.name}),'waiver_signature_required',409);requireIntake(tx.state,p.personId,[c.name]);
  person(tx.state,p.personId);insist(JSON.stringify(payerBasis(tx.state,p.personId))===p.payerBasis,'course_payer_changed',409);
  insist(c.sessions[0].start>now(),'course_already_started',409);tx.future(c.sessions[0].start);
  insist(enrollments(tx.state,c.id).filter(e=>e.status==='enrolled').length<c.capacity,'course_full',409);
  insist(!enrollments(tx.state,c.id).some(e=>e.personId===p.personId),'course_already_enrolled',409);
  const e={id:id(),courseId:c.id,personId:p.personId,payerId:p.payerId,locationId:c.locationId,previewId:p.id,amountCents:p.amountCents,policy:p.policy,status:'enrolled',createdAt:now(),attendance:[],installments:[{id:'deposit',dueAt:now(),amountCents:c.depositCents},...c.installments].map(r=>({...r,paidCents:0,creditedCents:0})),acceptedAt:p.acceptedAt,acceptedBy:p.acceptedBy};
  tx.put('courseEnrollment',e);tx.put('courseEnrollmentPreview',{...p,status:'enrolled',enrollmentId:e.id});
  for(const other of list(tx.state,'courseEnrollmentPreview').filter(r=>r.id!==p.id && r.courseId===c.id && r.personId===e.personId && r.status==='preview'))tx.put('courseEnrollmentPreview',{...other,status:'superseded',supersededBy:e.id});
  tx.put('charge',{id:id(),personId:e.payerId,forPersonId:e.personId,courseEnrollmentId:e.id,locationId:e.locationId,kind:'course-tuition',amountCents:e.amountCents,createdAt:now()});
  notice(tx,e,'enrolled',c.name+': '+e.policy);return e;
}
export function recordCoursePayment(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);const e=record(tx.state,input.id,'courseEnrollment'),reference=text(input.reference,'reference',200),amountCents=integer(input.amountCents,'amountCents',1,100_000_000);
  const previous=list(tx.state,'payment').find(p=>p.reference===reference);
  if(previous){insist(previous.courseEnrollmentId===e.id && previous.installmentId===input.installmentId && previous.amountCents===amountCents,'payment_reference_changed',409);return e;}
  const row=e.installments.find((r: any)=>r.id===input.installmentId);insist(row,'installment_not_found',404);
  insist(amountCents<=row.amountCents-row.paidCents-row.creditedCents,'installment_overpayment',409);
  const updated={...e,installments:e.installments.map((r: any)=>r.id===row.id?{...r,paidCents:r.paidCents+amountCents}:r)};
  tx.put('payment',{id:id(),personId:e.payerId,forPersonId:e.personId,courseEnrollmentId:e.id,installmentId:row.id,locationId:e.locationId,amountCents,reference,createdAt:now(),recordedBy:tx.who.id});tx.put('courseEnrollment',updated);return updated;
}
export function prepareWithdrawal(tx: Transaction,input: Record<string,unknown>) {
  authorizeCourse(tx,'course.withdraw.prepare',input);
  const e=record(tx.state,input.id,'courseEnrollment'),c=record(tx.state,e.courseId,'course');
  insist(e.status==='enrolled','course_already_withdrawn',409);
  const at=now(),rows=e.installments.map((r: any)=>({...r,creditCents:r.id!=='deposit' && r.dueAt>at ? r.amountCents-r.paidCents-r.creditedCents : 0}));
  const p={id:id(),courseId:c.id,personId:e.personId,enrollmentId:e.id,key:id(),status:'preview',basis:JSON.stringify(e),reason:text(input.reason,'withdrawal_reason',500),rows,creditCents:rows.reduce((n: number,r: any)=>n+r.creditCents,0),releasedSessions:c.sessions.filter((s: any)=>s.start>at).map((s: any)=>s.id),policy:e.policy,createdAt:at};
  tx.put('courseWithdrawalPreview',p);return p;
}
export function confirmWithdrawal(tx: Transaction,input: Record<string,unknown>) {
  authorizeCourse(tx,'course.withdraw.confirm',input);
  const p=record(tx.state,input.id,'courseWithdrawalPreview'),e=record(tx.state,p.enrollmentId,'courseEnrollment'),c=record(tx.state,e.courseId,'course');
  insist(input.key===p.key && input.confirm===true,'course_exact_confirmation_required',409);
  if(p.status==='applied')return e;
  insist(p.basis===JSON.stringify(e),'course_withdrawal_changed',409);
  // A preview crossing a due time or session start must be reviewed again.
  insist(p.rows.every((r: any)=>!r.creditCents || r.dueAt>now()) && p.releasedSessions.every((key: string)=>c.sessions.find((s: any)=>s.id===key).start>now()),'course_withdrawal_changed',409);
  for(const row of p.rows)if(row.creditCents)tx.future(row.dueAt);
  for(const key of p.releasedSessions)tx.future(c.sessions.find((s: any)=>s.id===key).start);
  const updated={...e,status:'withdrawn',withdrawnAt:now(),withdrawalId:p.id,installments:p.rows.map(({creditCents,...r}: any)=>({...r,creditedCents:r.creditedCents+creditCents}))};
  tx.put('courseEnrollment',updated);tx.put('courseWithdrawalPreview',{...p,status:'applied'});
  if(p.creditCents)tx.put('charge',{id:id(),personId:e.payerId,forPersonId:e.personId,courseEnrollmentId:e.id,locationId:e.locationId,kind:'course-withdrawal-credit',amountCents:-p.creditCents,reason:p.reason,createdAt:now()});
  notice(tx,updated,'withdrawn',c.name+': credited unpaid future tuition '+(p.creditCents/100).toFixed(2)+' USD. '+e.policy);return updated;
}
export function courseAttendance(tx: Transaction,input: Record<string,unknown>) {
  humanOwner(tx.who);const e=record(tx.state,input.id,'courseEnrollment'),c=record(tx.state,e.courseId,'course'),session=c.sessions.find((s: any)=>s.id===input.sessionId);
  insist(acknowledged(tx.state,e.personId,{id:c.id,service:c.name}),'waiver_signature_required',409);
  insist(e.status==='enrolled' && session,'course_session_unavailable',409);insist(session.start<=now(),'course_session_not_started',409);tx.reached(session.start);
  insist(['attended','absent'].includes(String(input.outcome)),'invalid_attendance');
  const previous=e.attendance.find((a: any)=>a.sessionId===session.id);
  if(previous){insist(previous.outcome===input.outcome,'attendance_correction_required',409);return e;}
  const updated={...e,attendance:[...e.attendance,{sessionId:session.id,outcome:input.outcome,at:now(),actorId:tx.who.id}]};tx.put('courseEnrollment',updated);return updated;
}
export function coursesSnapshot(s: State,who: Actor) {
  const owner=who.role==='owner',member=who.role==='member',staff=['front-desk','manager'].includes(who.role);
  const allowed=(personId: string,locationId: string)=>owner || member && personId===who.personId || staff && (hasStaffRight(s,who,'sale',personId,locationId) || hasStaffRight(s,who,'contract-change',personId,locationId));
  const courses: RecordData[]=list(s,'course').filter(c=>owner || member || staff && (hasStaffRight(s,who,'sale',undefined,c.locationId) || hasStaffRight(s,who,'contract-change',undefined,c.locationId))).map(c=>({...c,enrolled:enrollments(s,c.id).filter(e=>e.status==='enrolled').length}));
  const visible=list(s,'courseEnrollment').filter(e=>allowed(e.personId,e.locationId) || member && e.payerId===who.personId).map(e=>({...e,attendance:owner || e.personId===who.personId ? e.attendance : [],attendanceRestricted:!owner && e.personId!==who.personId,overdueCents:e.installments.filter((r: any)=>r.dueAt<=now()).reduce((n: number,r: any)=>n+r.amountCents-r.paidCents-r.creditedCents,0)}));
  const people=staff ? s.people.filter(p=>courses.some(c=>allowed(p.id,c.locationId))).map(p=>({id:p.id,name:p.name})) : [];
  const enrollPreviews=list(s,'courseEnrollmentPreview').filter(p=>owner || member && p.payerId===who.personId || staff && allowed(p.personId,s.records.get(p.courseId)!.data.locationId)).map(({payerBasis,...p})=>p);
  return {courses,people,enrollments:visible,previews:enrollPreviews,withdrawals:list(s,'courseWithdrawalPreview').filter(p=>owner || staff && hasStaffRight(s,who,'contract-change',p.personId,s.records.get(p.courseId)!.data.locationId)),canManage:owner || staff,canPublish:owner};
}
