// @ts-ignore The pinned Base portability module is JavaScript.
import { createPortability } from '@runeditrun/rer/modules/portability';
// @ts-ignore Shared Worker and CLI policy.
import archivePolicy from './archive-policy.mjs';
import { humanOwner, id, insist, instant, list, now, text, type Person, type RecordData, type State } from './domain/types';
import type { Transaction } from './domain/store';
import { hash } from './credentials';
import { importContext } from './movein';
import { privacyBillingKinds,retireBilling } from './privacy-billing';
import { relationshipKinds,redactRelationship } from './privacy-related';
import { retireD1ImportCustody, type D1Sql } from '../modules/import-kit/src/d1/index';

const disposable=new Set('memberCheckin memberProfile memberNote memberMessage memberPreference memberPreferenceEvent messagePreference messagePreferenceEvent messagePreferenceLaunch memberInvitation notice waiverLaunch waiverTabletLaunch intakeResponse intakeTabletLaunch attendanceAvailability attendancePlan renewalFollowup recognition recognitionLaunch recognitionPreference recognitionPreferenceEvent recoveryTask reminderTask reminderTaskEvent classReminder marketingMessage marketingSuppression marketingSyncPending smsConsentReceipt smsTestSubmission smsTestInbound smsTestStatus privacyReview absencePreview'.split(' '));
const financial=new Set('pack packCreditEvent packLocationChange charge payment booking approval introSale introIdentity introIdentityLink introIdentityEvent absence makeupCredit courseEnrollment courseEnrollmentPreview courseWithdrawalPreview'.split(' '));
const auditKinds=new Set(['profileChange','staffAction','bookingAction','staffAccessEvent']);
const scopeKinds=new Set('staffAccess memberRecordGrant waiverSigningGrant appointmentBookingGrant attendanceBookingGrant intakeSensitiveGrant retailStaffGrant'.split(' '));
const contains=(value: unknown, values: Set<string>): boolean => typeof value==='string'?values.has(value)
  :Array.isArray(value)?value.some(item=>contains(item,values)):!!value&&typeof value==='object'&&Object.values(value).some(item=>contains(item,values));
/** Follow references toward dependent records, never toward global documents or another member's ledger. */
function subjectRecords(state: State, member: Person) {
  const selected=new Map<string,{kind:string;data:RecordData}>(), keys=new Set([member.id,member.email!]);
  let changed=true;
  while(changed) {
    changed=false;
    for(const [key,row] of state.records) {
      if(selected.has(key) || row.kind==='privacyRetention' || row.kind==='privacyRequest')continue;
      if(contains(row.data,keys)) { selected.set(key,row); if(!scopeKinds.has(row.kind)&&!auditKinds.has(row.kind)&&!relationshipKinds.has(row.kind))keys.add(key); changed=true; }
    }
  }
  return [...selected.values()];
}
function supportedRecords(state: State, member: Person) {
  const records=subjectRecords(state,member);
  const unsupported=records.filter(({kind,data})=>!disposable.has(kind)&&!financial.has(kind)&&!auditKinds.has(kind)&&!scopeKinds.has(kind)&&!relationshipKinds.has(kind)&&!privacyBillingKinds.has(kind)&&kind!=='acknowledgement'&&!(kind==='draft'&&['pack','reminder'].includes(data.type)));
  insist(!unsupported.length,'privacy_related_work_requires_review:'+ [...new Set(unsupported.map(r=>r.kind))].sort().join(','),409);
  const shared=records.some(({data,kind})=>!auditKinds.has(kind) && !scopeKinds.has(kind) && !relationshipKinds.has(kind) && data.personId && data.personId!==member.id && !(kind==='charge'&&data.forPersonId===member.id));
  insist(!shared,'privacy_shared_member_work_requires_review',409);
  insist(!records.some(({kind,data})=>kind==='stripeInvoice'&&!['paid','expired'].includes(data.status)||kind==='billingOperation'&&['pending','uncertain'].includes(data.status)),'privacy_resolve_pending_provider_work_first',409);
  insist(!records.some(({kind,data})=>kind==='courseEnrollment'&&data.status==='enrolled'&&
    (state.records.get(data.courseId)?.data.sessions??[]).some((session:RecordData)=>session.end>now())),'privacy_withdraw_future_course_first',409);
  // The ordinary cancellation door must resolve capacity, fees and notices first.
  insist(!records.some(({kind,data})=>kind==='booking'&&data.status!=='cancelled'&&
    (state.records.get(data.classId)?.data.end ?? '')>now()),'privacy_cancel_future_bookings_first',409);
  return records;
}

export function erasureReview(state: State, member: Person, input: Record<string,unknown>) {
  insist(member.email?.toLowerCase()!==state.operator.email.toLowerCase(),'privacy_owner_identity_refused',409);
  const obligations=text(input.obligations,'obligations',20);
  insist(['settled','retain','cancel'].includes(obligations),'invalid_obligation_decision');
  const balanceCents=list(state,'charge').filter(r=>r.personId===member.id).reduce((n,r)=>n+r.amountCents,0)
    -list(state,'payment').filter(r=>r.personId===member.id).reduce((n,r)=>n+r.amountCents,0);
  insist(obligations!=='settled' || balanceCents===0,'privacy_outstanding_balance',409);
  insist(obligations!=='cancel' || balanceCents>=0,'privacy_refund_requires_settlement',409);
  const reason=text(input.reason,'reason',500),retainUntil=instant(input.retainUntil,'retainUntil');
  insist(Date.parse(retainUntil)>Date.now(),'privacy_retention_date_required');
  insist(input.retireAccess===true,'privacy_access_retirement_required');
  const documents=text(input.documents,'documents',20);
  insist(['delete','retain'].includes(documents),'invalid_document_decision');
  const hold=input.holdBasis ? {basis:text(input.holdBasis,'holdBasis',500),scope:'member-documents',
    reviewAt:instant(input.holdReviewAt,'holdReviewAt'),releaseCondition:text(input.holdReleaseCondition,'holdReleaseCondition',500)} : null;
  insist(!hold || documents==='retain','privacy_hold_requires_retention');
  insist(!hold || Date.parse(hold.reviewAt)>Date.now(),'privacy_hold_review_date_required');
  const records=supportedRecords(state,member);
  return {obligations,balanceCents,retireAccess:true,documents,retention:{reason,retainUntil},hold,
    inventory:records.map(({kind,data})=>({id:data.id,kind,disposition:financial.has(kind)?'pseudonymous-financial':kind==='acknowledgement'?documents:'remove-personal-values'}))};
}
export async function disposeRetention(tx: Transaction, retained: RecordData) {
  const portability=await createPortability({db:tx.db,policy:archivePolicy});
  tx.sql.push(...await portability.redactionStatements(),...await portability.invalidateTransfersStatements());
  tx.sql.push(tx.statement('DELETE FROM st_records WHERE id=? AND kind=?',retained.id,'privacyRetention'));
}
/** Collect Base's own checkpoint SQL without changing its policy or transaction boundary. */
async function checkpoint(db: D1Database): Promise<D1Sql[]> {
  const specs=new WeakMap<object,D1Sql>();
  const prepare=(sql:string,params:unknown[]=[]): any => {
    const native=params.length?db.prepare(sql).bind(...params):db.prepare(sql);
    const wrapped=new Proxy(native,{get(target,key) {
      if(key==='bind')return (...values:unknown[])=>prepare(sql,values);
      if(key==='privacySql')return {sql,params};
      const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;
    }});
    specs.set(wrapped,{sql,params});return wrapped;
  };
  const recording=new Proxy(db,{get(target,key) {
    if(key==='prepare')return prepare;
    const value=(target as any)[key];return typeof value==='function'?value.bind(target):value;
  }});
  const portability=await createPortability({db:recording,policy:archivePolicy});
  return [...await portability.redactionStatements(),...await portability.invalidateTransfersStatements()].map(statement=>{
    const spec=(statement as any).privacySql ?? specs.get(statement);insist(spec,'privacy_checkpoint_unavailable',500);return spec;
  });
}
const auditFields=new Set('id personId action command actorId actorRole staffMade right channel at createdAt changed'.split(' '));
const privateFields=new Set('name email phone emergencyContact before after result requestBasis reason comment note notes cancelReason suppressionReason body subject recipient text signature url checkoutUrl providerSessionId paymentMethodId customerId'.split(' '));
const financialReasons=new Set('initiation_fee late_cancel_fee no_show_fee late_move_fee fee_reversal freeze_fee_reversal guest_drop_in guest_drop_in_reversal appointment_price appointment_price_reversal appointment_price_restoration gift_card_issue gift_card_redemption retail_sale retail_return sales_tax sales_tax_reversal empty_place_incentive referral_reward cooling_off_unpaid_void late_cancel no_show attendance_correction cancellation_restored class_cancelled absence absence_restored unpaid_visit_settled private_appointment_move'.split(' '));
function redact(value: any, identities: string[], key=''): any {
  if(privateFields.has(key))return null;
  if(Array.isArray(value))return value.map(item=>redact(item,identities));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([name])=>!/(token|secret)/i.test(name)).map(([name,item])=>[name,redact(item,identities,name)]));
  if(typeof value==='string')for(const identity of identities)if(identity && value.toLowerCase().includes(identity.toLowerCase()))return '[erased]';
  return value;
}
export async function eraseUsedMember(db: D1Database, tx: Transaction, request: RecordData, review: RecordData, member: Person): Promise<RecordData> {
  humanOwner(tx.who);
  const records=supportedRecords(tx.state,member),at=now(),erasedAt=Date.now();
  const identities=[member.email!,member.name,...list(tx.state,'profileChange').filter(p=>p.personId===member.id).flatMap(p=>[p.before?.email,p.after?.email,p.before?.name,p.after?.name])].filter((value):value is string=>typeof value==='string'&&value.length>0);
  const emails=new Set(identities.filter(value=>value.includes(String.fromCharCode(64))).map(value=>value.toLowerCase()));
  insist(!tx.state.people.some(other=>other.id!==member.id && !other.erasedAt && other.email && emails.has(other.email.toLowerCase())),'privacy_historical_identity_reassigned',409);
  const operators=(await db.prepare('SELECT id,role,email FROM oa_operators').all<{id:string;role:string;email:string}>()).results.filter(operator=>emails.has(operator.email.toLowerCase()));
  insist(operators.every(o=>o.role!=='owner'),'privacy_owner_identity_refused',409);
  const native:D1Sql[]=[],sql=(sql:string,...params:unknown[])=>native.push({sql,params});
  const put=(kind:string,data:RecordData)=>sql('INSERT INTO st_records(id,kind,data,version) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=excluded.version',data.id,kind,JSON.stringify(data),tx.state.version+1);
  sql('INSERT INTO st_assert(value) SELECT CASE WHEN version=? THEN 1 ELSE 0 END FROM st_meta WHERE id=1',tx.state.version);
  sql("INSERT INTO st_assert(value) SELECT CASE WHEN EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND email=? AND status='active' AND role='owner' AND version=?) THEN 1 ELSE 0 END",tx.who.id,tx.who.email,tx.state.operator.version);
  const receipt={id:id(),personId:member.id,requestId:request.id,erasedAt:at,actorId:tx.who.id,actorRole:tx.who.role,right:'privacy',channel:request.channel,
    obligations:review.obligations,balanceBeforeCents:review.balanceCents,balanceAfterCents:review.obligations==='cancel'?0:review.balanceCents,
    retention:review.retention,documents:review.documents,externalCopies:'Not erased: provider accounts and copies outside this installation require separate handling.'};
  for(const {kind,data} of records) {
    if(['waiverTabletLaunch','intakeTabletLaunch'].includes(kind))sql('DELETE FROM st_intake_tablets WHERE id=?',data.id);
    if(kind==='waiverLaunch')sql('DELETE FROM st_waiver_launch_dispatches WHERE id=?',data.id);
    if((kind==='acknowledgement'||kind==='billingAgreement'&&data.signature) && review.documents==='retain') {
      const copies=kind==='acknowledgement'?(await db.prepare('SELECT created_at,finished_at,delivery_status,provider FROM st_evidence_copies WHERE receipt_id=?').bind(data.id).all()).results:[];
      const retained={id:id(),personId:member.id,recordClass:kind==='billingAgreement'?'membership-agreement':'member-documents',sourceId:data.id,reason:review.retention.reason,retainUntil:review.retention.retainUntil,
        hold:review.hold?{...review.hold,actorId:tx.who.id,createdAt:at}:null,createdAt:at,createdBy:tx.who.id,
        content:kind==='billingAgreement'?{agreement:data,mandate:list(tx.state,'paymentMandate').find(m=>m.agreementId===data.id)??null}:{receipt:data,document:tx.state.records.get(data.waiverId)?.data ?? null,personalCopies:copies}};
      put('privacyRetention',retained);
    }
    if(privacyBillingKinds.has(kind)) {
      put(kind,retireBilling(kind,data,{...redact(data,identities),privacyReceiptId:receipt.id},at,tx.who.id));
    } else if(relationshipKinds.has(kind)) {
      put(kind,redactRelationship(kind,data,member,identities,tx.state,at,tx.who.id));
    } else if(scopeKinds.has(kind)) {
      const removeScope=(value:any,key=''):any=>Array.isArray(value)?value.filter(item=>!['memberIds','personIds'].includes(key)||item!==member.id).map(item=>removeScope(item)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([name,item])=>[name,removeScope(item,name)])):value;
      put(kind,{...removeScope(data),...(data.personId===member.id?{enabled:false,rights:{}}:{}),version:(data.version??0)+1,updatedAt:at,updatedBy:tx.who.id});
    } else if(financial.has(kind) || kind==='draft'&&data.type==='pack') {
      const sanitized=redact(data,identities);
      // Purchased plan labels are financial facts; personal values embedded in them still redact.
      if(data.entitlement)sanitized.entitlement.name=redact(data.entitlement.name,identities);
      // Keep controlled ledger classifications, never free-form personal explanations.
      if(['charge','payment','packCreditEvent'].includes(kind)&&financialReasons.has(data.reason))sanitized.reason=data.reason;
      if(['courseEnrollmentPreview','courseWithdrawalPreview'].includes(kind))Object.assign(sanitized,{key:null,basis:null,payerBasis:null,participantName:null,status:'retired'});
      if(kind==='makeupCredit')Object.assign(sanitized,{voidedAt:data.voidedAt??at,voidedBy:tx.who.id,voidReason:'Member erasure'});
      if(kind==='payment') {sanitized.referenceHash=await hash(String(data.reference));sanitized.reference='Retained receipt '+data.id;}
      put(kind,{...sanitized,erased:true,privacyReceiptId:receipt.id});
    } else if(auditKinds.has(kind)) {
      put(kind,{...Object.fromEntries(Object.entries(data).filter(([key])=>auditFields.has(key))),id:data.id,erased:true});
    } else sql('DELETE FROM st_records WHERE id=?',data.id);
  }
  if(review.obligations==='cancel' && review.balanceCents>0)put('charge',{id:id(),personId:member.id,kind:'privacy-obligation-cancellation',amountCents:-review.balanceCents,createdAt:at,createdBy:tx.who.id,privacyReceiptId:receipt.id,erased:true});
  sql('DELETE FROM st_notice_deliveries WHERE person_id=?',member.id);
  sql('DELETE FROM st_evidence_copies WHERE person_id=?',member.id);
  sql('DELETE FROM st_import_people_revisions WHERE person_id=?',member.id);
  // Redact every previous identity recorded by the owner, not just the current sign-in.
  for(const email of new Set(identities.filter(value=>value.includes(String.fromCharCode(64))))) {
    sql('INSERT OR IGNORE INTO st_erasure_journal(identity_hash,erased_at) VALUES(?,?)',await hash(email.toLowerCase()),erasedAt);
    sql('DELETE FROM rer_mail_development_outbox WHERE instr(lower(message),lower(?))>0',email);
    sql('DELETE FROM oa_auth_audit WHERE instr(lower(value),lower(?))>0',email);
  }
  for(const operator of operators) {
    for(const table of ['oa_external_identities','oa_credentials','oa_step_up_challenges','st_mfa_factors','st_mfa_recovery','st_mfa_sessions','st_mfa_challenges'])sql('DELETE FROM '+table+' WHERE operator_id=?',operator.id);
    for(const table of ['oa_provider_sessions','oa_provider_session_pins'])sql('DELETE FROM '+table+' WHERE session_id IN (SELECT id FROM oa_sessions WHERE operator_id=?)',operator.id);
    sql('UPDATE oa_sessions SET revoked_at=? WHERE operator_id=?',erasedAt,operator.id);
    sql('UPDATE oa_tokens SET revoked_at=? WHERE operator_id=? OR issuer_id=?',erasedAt,operator.id,operator.id);
    sql("UPDATE st_security_audit SET actor_email=CASE WHEN actor_id=? THEN '' ELSE actor_email END,subject_email=CASE WHEN subject_id=? THEN NULL ELSE subject_email END,detail='{}' WHERE actor_id=? OR subject_id=?",operator.id,operator.id,operator.id,operator.id);
    sql("UPDATE oa_operators SET email=?,display_name='Erased person',status='inactive',version=version+1 WHERE id=?", 'erased-'+operator.id+String.fromCharCode(64)+'invalid.local',operator.id);
  }
  sql("UPDATE st_people SET name='Erased person',email=?,active=0,version=version+1,erased_at=? WHERE id=?", 'erased-'+member.id+String.fromCharCode(64)+'invalid.local',erasedAt,member.id);
  for(const entry of list(tx.state,'privacyRequest').filter(row=>row.personId===member.id))put('privacyRequest',{...entry,requestId:null,identityBasis:null,status:'erased',erasedAt:at,receiptId:receipt.id});
  put('privacyReceipt',receipt);
  put('staffAction',{id:id(),action:'privacy.erase.confirm',command:'privacy.erase.confirm',personId:member.id,actorId:tx.who.id,actorRole:tx.who.role,staffMade:true,right:'privacy',channel:request.channel,at,
    before:{privacy:true,status:'verified',balanceCents:review.balanceCents},after:{privacy:true,status:'erased',receiptId:receipt.id,balanceCents:receipt.balanceAfterCents}});
  sql('UPDATE st_meta SET version=version+1 WHERE id=1');sql('DELETE FROM st_assert');
  const context=importContext(db,tx.who), targets=context.storage.targets;
  // Import custody regards a redacted, fenced identity as absent. The stable native ID remains for the ledger.
  const privacyTargets={...targets,matches(row:any,dest:string,kind:string,key:string) {
    return row?targets.matches(row,dest,kind,key):{sql:'EXISTS(SELECT 1 FROM st_people WHERE id=? AND erased_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM st_import_people_revisions WHERE person_id=?)',params:[key,key]};
  }};
  try {
    await retireD1ImportCustody({target:{kind:'member',id:member.id},values:[...new Set(identities)]},native,
      {...context,storage:{...context.storage,targets:privacyTargets}},await checkpoint(db));
  } catch(error) {
    if(/st_assert|CHECK constraint|IMPORT_ATOMIC_GUARD|IMPORT_FINAL_GUARD/.test(String(error)))insist(false,'privacy_review_changed',409);
    throw error;
  }
  return receipt;
}
