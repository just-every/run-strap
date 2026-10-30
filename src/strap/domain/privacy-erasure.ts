// @ts-ignore The Worker and CLI share Base's JavaScript portability policy.
import { createPortability } from '@runeditrun/rer/modules/portability';
// @ts-ignore The CLI and Worker share the JavaScript archive policy.
import archivePolicy from '../archive-policy.mjs';
import { balance } from './money';
import { assembleWaiverEvidence } from '../waiver-evidence';
import { privacyAuthority, privacyHash, verifiedPrivacyRequest } from './privacy';
import { id, insist, instant, list, now, person, record, text, type RecordData } from './types';
import type { Transaction } from './store';

const removable=new Set(['memberProfile','memberCheckin','memberPreference','memberPreferenceEvent','messagePreference','messagePreferenceEvent',
  'memberNote','memberMessage','intakeResponse','acknowledgement','notice','waiverLaunch','memberInvitation','intakeTabletLaunch','waiverTabletLaunch']);
const auditFields='id action command personId actorId actorRole staffMade right channel at changed revision'.split(' ');
const retained: Record<string,string[]>={
  pack:'id personId locationId eligibleLocations eligibleServices priorityBooking proration credits remaining amountCents purchaseAmountCents initiationFeeCents expiresAt termStartAt createdAt creditLedgerVersion creditRevision draftId'.split(' '),
  packCreditEvent:'id personId packId type credits originalCredits remainingAfter expiresAtBefore expiresAtAfter revision createdAt actorId actorRole bookingId classId reservations'.split(' '),
  booking:'id personId classId packId status attendance createdAt cancelledAt checkedInAt checkedInBy'.split(' '),
  charge:'id personId forPersonId packId bookingId amountCents locationId createdAt'.split(' '),
  payment:'id personId packId amountCents locationId reference createdAt recordedBy'.split(' '),
  draft:'id personId type status credits amountCents expiresAt createdAt createdBy createdByRole approvedAt approvedBy'.split(' '),
  approval:'id draftId type approvedBy approvedAt'.split(' '),
  profileChange:auditFields,
  staffAction:auditFields,
  bookingAction:[...auditFields,...'bookingId classId targetClassId type feeCents creditReturned'.split(' ')],
  privacyRequest:'id personId type status channel receivedAt recordedBy verifiedAt verifiedBy fulfilledAt fulfilledBy'.split(' '),
  privacyErasurePreview:'id personId requestId status createdAt createdBy'.split(' '),
};
const pick=(data: RecordData,fields: string[])=>Object.fromEntries(fields.filter(key=>data[key]!==undefined).map(key=>[key,data[key]])) as RecordData;
const leaves=(value: unknown): string[]=>typeof value==='string'?[value]:value&&typeof value==='object'?Object.values(value).flatMap(leaves):[];
const emails=(value: unknown): string[]=>!value||typeof value!=='object'?[]:Object.entries(value).flatMap(([key,child])=>key==='email'&&typeof child==='string'?[child.toLowerCase()]:emails(child));

/** Unsupported relationships stay intact and visible as a refusal. The review
 * never infers authority to erase another participant or execute a provider. */
async function erasureScope(tx: Transaction,personId: string) {
  const member=person(tx.state,personId,false);
  const originals=(await tx.db.prepare("SELECT record_json FROM ik_provenance WHERE destination='strap:members' AND target_kind='member' AND target_id=? UNION SELECT record_json FROM ik_d1_history WHERE destination='strap:members' AND target_kind='member' AND target_id=?").bind(member.id,member.id).all()).results;
  const historicalAliases=[...new Set([...(member.email?[member.email.toLowerCase()]:[]),
    ...list(tx.state,'profileChange').filter(row=>row.personId===member.id).flatMap(emails),
    ...originals.flatMap(row=>emails(JSON.parse(String(row.record_json))))])].sort();
  const operators=(await tx.db.prepare(`SELECT id,role,version FROM oa_operators WHERE lower(email) IN (${historicalAliases.map(()=>'?').join(',')}) ORDER BY id`).bind(...historicalAliases).all()).results;
  const identities=new Set([member.id,...operators.map(row=>String(row.id))]),selected=new Map<string,{kind:string;data:RecordData}>();
  let changed=true;
  while(changed) {
    changed=false;
    for(const [key,row] of tx.state.records)if(!selected.has(key)&&leaves(row.data).some(value=>identities.has(value))) {
      selected.set(key,row);identities.add(key);changed=true;
    }
  }
  const unsupported=new Set([...selected.values()].filter(row=>!removable.has(row.kind)&&!retained[row.kind]).map(row=>row.kind));
  if(operators.some(row=>row.role==='owner')||list(tx.state,'staffAccess').some(row=>row.personId===member.id))unsupported.add('staff_identity');
  for(const {kind,data} of selected.values()) {
    if(kind==='pack'&&(data.entitlement||data.guestTerms||data.introSaleId||data.familyInvoiceId))unsupported.add('nonstandard_pack');
    if(kind==='booking'&&data.status!=='cancelled'&&Date.parse(tx.state.records.get(data.classId)?.data.end??'9999-12-31')>Date.now())unsupported.add('future_booking_requires_cancellation');
    if(kind==='draft'&&data.type!=='pack'&&data.type!=='reminder')unsupported.add('nonstandard_draft');
    if(kind==='charge'&&(data.forPersonId&&data.forPersonId!==member.id||data.personId!==member.id))unsupported.add('shared_financial_obligation');
    if(kind==='payment'&&data.collection)unsupported.add('provider_payment');
    if(['acknowledgement','intakeResponse'].includes(kind)&&data.personId!==member.id)unsupported.add('another_participant_document');
  }
  const deliveries=(await tx.db.prepare('SELECT * FROM st_notice_deliveries WHERE person_id=? ORDER BY id').bind(member.id).all()).results;
  const holds=(await tx.db.prepare('SELECT * FROM st_privacy_retained WHERE person_id=? ORDER BY id').bind(member.id).all()).results;
  const snapshots=[...selected].sort(([a],[b])=>a.localeCompare(b));
  const aliases=[...new Set([...historicalAliases,...snapshots.flatMap(([,row])=>emails(row.data))])].sort();
  if(tx.state.people.some(peer=>peer.id!==member.id&&!peer.erasedAt&&peer.email&&aliases.includes(peer.email.toLowerCase())))unsupported.add('historical_identity_reused');
  return {member,operators,selected,unsupported:[...unsupported].sort(),balanceCents:balance(tx.state,member.id),
    aliases,basis:await privacyHash(JSON.stringify({member,operators,snapshots,deliveries,holds,originals})),
    counts:Object.fromEntries([...new Set(snapshots.map(([,row])=>row.kind))].sort().map(kind=>[kind,snapshots.filter(([,row])=>row.kind===kind).length]))};
}

export async function preparePrivacyErasure(tx: Transaction,input: Record<string,unknown>) {
  const {request,member}=verifiedPrivacyRequest(tx,input,'erasure'),scope=await erasureScope(tx,member.id);
  insist(input.financialDecision==='resolved'||input.financialDecision==='retain','financial_decision_required');
  if(input.financialDecision==='resolved')insist(scope.balanceCents===0,'resolve_or_explicitly_retain_obligations',409);
  const retainUntil=instant(input.retainUntil,'retainUntil');insist(retainUntil>now(),'retention_date_must_be_future');
  const preview={id:id(),personId:member.id,requestId:request.id,status:'prepared',createdAt:now(),createdBy:tx.who.id,
    basis:scope.basis,counts:scope.counts,unsupported:scope.unsupported,balanceCents:scope.balanceCents,
    financialDecision:input.financialDecision,retentionReason:text(input.retentionReason,'retentionReason',1000),retainUntil,
    effects:'Revoke sign-in and personal copies, remove unnecessary native notes and documents, redact profile history, retain original pseudonymous ledger amounts and justified external receipt references. Unused access cannot be recovered. External copies are unchanged.'};
  tx.put('privacyErasurePreview',preview);return preview;
}

export async function confirmPrivacyErasure(tx: Transaction,input: Record<string,unknown>) {
  privacyAuthority(tx);
  const preview=record(tx.state,input.id,'privacyErasurePreview');
  const {request,member}=verifiedPrivacyRequest(tx,{id:preview.requestId},'erasure');
  insist(preview.status==='prepared'&&input.confirm===true&&input.basis===preview.basis,'privacy_exact_erasure_review_required',409);
  // The preview and its canonical audit were added after the observed scope.
  const saved=[...tx.state.records].filter(([,row])=>row.kind==='privacyErasurePreview'&&row.data.id===preview.id||row.kind==='staffAction'&&row.data.after?.id===preview.id);
  for(const [key] of saved)tx.state.records.delete(key);
  const scope=await erasureScope(tx,member.id);
  for(const [key,row] of saved)tx.state.records.set(key,row);
  insist(scope.basis===preview.basis,'privacy_erasure_scope_changed',409);
  insist(!scope.unsupported.length,'privacy_unsupported_records_require_review',409);
  insist(preview.retainUntil>now(),'retention_review_expired',409);
  const portability=await createPortability({db:tx.capturedDatabase(),policy:archivePolicy});
  const checkpoint=await portability.redactionStatements();
  tx.sql.push(...await portability.invalidateTransfersStatements());
  const erasedAt=Date.now();
  for(const [key,{kind,data}] of scope.selected) {
    if(removable.has(kind)) {
      if(kind==='intakeTabletLaunch'||kind==='waiverTabletLaunch')tx.sql.push(tx.statement('DELETE FROM st_intake_tablets WHERE id=?',key));
      if(kind==='waiverLaunch')tx.sql.push(tx.statement('DELETE FROM st_waiver_launch_dispatches WHERE id=?',key));
      tx.state.records.delete(key);tx.sql.push(tx.statement('DELETE FROM st_records WHERE id=?',key));
    } else tx.put(kind,{...pick(data,retained[kind]),erased:true});
  }
  // The review itself and the access requests retain only event provenance.
  for(const [key,{kind,data}] of saved)tx.put(kind,{...pick(data,kind==='staffAction'?auditFields:retained.privacyErasurePreview),erased:true,status:'confirmed'});
  tx.sql.push(tx.statement('DELETE FROM st_notice_deliveries WHERE person_id=?',member.id));
  tx.sql.push(tx.statement('DELETE FROM st_evidence_copies WHERE person_id=?',member.id));
  for(const operator of scope.operators) {
    tx.sql.push(tx.statement('DELETE FROM oa_provider_session_pins WHERE session_id IN (SELECT id FROM oa_sessions WHERE operator_id=?)',operator.id));
    tx.sql.push(tx.statement('DELETE FROM oa_provider_sessions WHERE session_id IN (SELECT id FROM oa_sessions WHERE operator_id=?)',operator.id));
    tx.sql.push(tx.statement('DELETE FROM oa_step_up_challenges WHERE operator_id=?',operator.id));
    for(const table of ['oa_sessions','oa_tokens','oa_credentials','oa_external_identities','st_mfa_factors','st_mfa_recovery','st_mfa_sessions','st_mfa_challenges'])
      tx.sql.push(tx.statement(`DELETE FROM ${table} WHERE operator_id=?`,operator.id));
    tx.sql.push(tx.statement("UPDATE st_security_audit SET actor_email=CASE WHEN actor_id=? THEN '' ELSE actor_email END,subject_email=NULL,detail='{}' WHERE actor_id=? OR subject_id=?",operator.id,operator.id,operator.id));
    tx.sql.push(tx.statement("UPDATE oa_auth_audit SET value='{}' WHERE actor_id=?",operator.id));
    tx.sql.push(tx.statement("UPDATE oa_operators SET email=?,display_name='Erased person',status='inactive',version=version+1 WHERE id=?",`erased-${operator.id}@invalid.local`,operator.id));
  }
  for(const email of scope.aliases) {
    tx.sql.push(tx.statement('INSERT INTO st_erasure_journal(identity_hash,erased_at) VALUES(?,?) ON CONFLICT(identity_hash) DO NOTHING',await privacyHash(email),erasedAt));
    tx.sql.push(tx.statement('DELETE FROM rer_mail_development_outbox WHERE EXISTS(SELECT 1 FROM json_each(message,\'$.to\') WHERE lower(value)=?)',email));
    tx.sql.push(tx.statement("UPDATE oa_auth_audit SET value='{}' WHERE instr(lower(value),?)>0",email));
    tx.sql.push(tx.statement("UPDATE st_security_audit SET actor_email=CASE WHEN lower(actor_email)=? THEN '' ELSE actor_email END,subject_email=CASE WHEN lower(subject_email)=? THEN NULL ELSE subject_email END,detail='{}' WHERE lower(actor_email)=? OR lower(subject_email)=? OR subject_id=?",email,email,email,email,member.id));
  }
  tx.sql.push(tx.statement("UPDATE st_people SET name='Erased person',email=?,active=0,role='member',version=version+1,erased_at=? WHERE id=?",`erased-${member.id}@invalid.local`,erasedAt,member.id));
  tx.sql.push(tx.statement('DELETE FROM st_import_people_revisions WHERE person_id=?',member.id));
  const receipt={id:id(),personId:member.id,requestId:request.id,previewId:preview.id,erasedAt:new Date(erasedAt).toISOString(),
    financialDecision:preview.financialDecision,balanceCents:scope.balanceCents,retentionReason:preview.retentionReason,retainUntil:preview.retainUntil,
    counts:scope.counts,externalCopies:'not_erased',actorId:tx.who.id};
  tx.put('privacyErasureReceipt',receipt);
  tx.put('privacyRequest',{...pick(request,retained.privacyRequest),status:'fulfilled',fulfilledAt:receipt.erasedAt,fulfilledBy:tx.who.id,erased:true});
  tx.importErasure={personId:member.id,values:[member.id,...scope.aliases,member.name],checkpoint};
  return receipt;
}

export function retainPrivacyDocument(tx: Transaction,input: Record<string,unknown>) {
  privacyAuthority(tx);
  const member=person(tx.state,input.personId,false),document=record(tx.state,input.id,'acknowledgement');
  insist(document.personId===member.id,'privacy_document_member_mismatch',404);
  const retainUntil=instant(input.retainUntil,'retainUntil');insist(retainUntil>now(),'retention_date_must_be_future');
  insist(input.confirm===true&&typeof input.hold==='boolean','privacy_retention_confirmation_required');
  const receipt={id:id(),personId:member.id,documentId:document.id,kind:'acknowledgement',
    reason:text(input.reason,'reason',1000),retainUntil,
    holdBasis:input.hold?text(input.holdBasis,'holdBasis',1000):null,
    releaseConditions:input.hold?text(input.releaseConditions,'releaseConditions',1000):null,
    recordedBy:tx.who.id,recordedAt:now()};
  tx.sql.push(tx.statement('INSERT INTO st_privacy_retained(id,person_id,kind,data,reason,retain_until,hold_basis,release_conditions,recorded_by,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    receipt.id,member.id,receipt.kind,JSON.stringify({...document,evidence:assembleWaiverEvidence(document,record(tx.state,document.waiverId,'waiver'))}),receipt.reason,retainUntil,receipt.holdBasis,receipt.releaseConditions,tx.who.id,receipt.recordedAt));
  return receipt;
}

async function retainedDocument(tx: Transaction,input: Record<string,unknown>) {
  privacyAuthority(tx);
  const row=await tx.db.prepare('SELECT * FROM st_privacy_retained WHERE id=?').bind(text(input.id,'id',100)).first<RecordData>();
  insist(row,'privacy_retained_document_not_found',404);
  return row;
}
const retentionReceipt=(row: RecordData)=>({id:row.id,personId:row.person_id,kind:row.kind,reason:row.reason,
  retainUntil:row.retain_until,holdBasis:row.hold_basis,releaseConditions:row.release_conditions,
  releasedAt:row.released_at,disposedAt:row.disposed_at});

export async function readPrivacyDocument(tx: Transaction,input: Record<string,unknown>) {
  const row=await retainedDocument(tx,input);insist(!row.disposed_at,'privacy_document_disposed',410);
  return {...retentionReceipt(row),bundle:JSON.parse(row.data)};
}
export async function releasePrivacyHold(tx: Transaction,input: Record<string,unknown>) {
  const row=await retainedDocument(tx,input);
  insist(row.hold_basis&&!row.released_at&&!row.disposed_at,'privacy_active_hold_required',409);
  insist(input.confirm===true,'privacy_hold_release_confirmation_required');
  const releasedAt=now(),reason=text(input.reason,'reason',1000);
  tx.sql.push(tx.statement('UPDATE st_privacy_retained SET released_by=?,released_at=?,release_reason=? WHERE id=?',tx.who.id,releasedAt,reason,row.id));
  return {...retentionReceipt(row),releasedAt,releaseReason:reason};
}
export async function disposePrivacyDocument(tx: Transaction,input: Record<string,unknown>) {
  const row=await retainedDocument(tx,input);
  insist(!row.disposed_at,'privacy_document_disposed',410);
  insist(!row.hold_basis||row.released_at,'privacy_document_on_hold',409);
  insist(row.retain_until<=now(),'privacy_retention_not_elapsed',409);tx.reached(row.retain_until);
  insist(input.confirm===true,'privacy_disposal_confirmation_required');
  const disposedAt=now(),reason=text(input.reason,'reason',1000);
  tx.sql.push(tx.statement("UPDATE st_privacy_retained SET data='{}',disposed_by=?,disposed_at=? WHERE id=?",tx.who.id,disposedAt,row.id));
  return {...retentionReceipt(row),disposedAt,disposalReason:reason};
}
