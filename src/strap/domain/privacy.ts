import { profileOf } from './profiles';
import { assembleWaiverEvidence } from '../waiver-evidence';
import { staffChannel } from './staff-actions';
import { requireStaffRight } from './staff-rights';
import { humanOwner, id, insist, list, now, person, record, text, type RecordData } from './types';
import type { Transaction } from './store';

/** Privacy authority is deliberately owner-only, including on a replay. */
export function privacyAuthority(tx: Transaction) {
  humanOwner(tx.who);
  requireStaffRight(tx.state,tx.who,'privacy');
}

export async function privacyHash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export function recordPrivacyRequest(tx: Transaction,input: Record<string,unknown>) {
  privacyAuthority(tx);
  const member=person(tx.state,input.personId,false);
  insist(member.role==='member','member_required');
  insist(input.type==='access'||input.type==='erasure','invalid_request_type');
  const request={id:id(),personId:member.id,type:input.type,status:'requested',channel:staffChannel(input),
    sourceReference:text(input.sourceReference,'sourceReference',200),receivedAt:now(),recordedBy:tx.who.id,
    personVersion:member.version};
  tx.put('privacyRequest',request);
  return request;
}

export function verifyPrivacyRequest(tx: Transaction,input: Record<string,unknown>) {
  privacyAuthority(tx);
  const request=record(tx.state,input.id,'privacyRequest'),member=person(tx.state,request.personId,false);
  insist(request.status!=='fulfilled','privacy_request_fulfilled',409);
  insist(input.confirm===true,'identity_verification_confirmation_required');
  // Store an evidence reference, never an identity document or its number.
  const verified={...request,status:'verified',personVersion:member.version,verifiedAt:now(),verifiedBy:tx.who.id,
    verificationReference:text(input.verificationReference,'verificationReference',200),export:null};
  tx.put('privacyRequest',verified);
  return verified;
}

export function verifiedPrivacyRequest(tx: Transaction,input: Record<string,unknown>,type: string) {
  privacyAuthority(tx);
  const request=record(tx.state,input.id,'privacyRequest'),member=person(tx.state,request.personId,false);
  insist(request.type===type,'privacy_request_type_mismatch',409);
  insist(['verified','exported'].includes(request.status)&&request.verifiedAt,'privacy_identity_verification_required',409);
  insist(request.personVersion===member.version,'privacy_identity_changed_reverify',409);
  return {request,member};
}

/** The owner reviews this private native copy before delivering it. It contains
 * no credentials or original import artifacts that might hold other members. */
export async function exportPrivacyAccess(tx: Transaction,input: Record<string,unknown>) {
  const {request,member}=verifiedPrivacyRequest(tx,input,'access');
  const kinds=new Set(['memberProfile','profileChange','memberPreference','memberPreferenceEvent','messagePreference',
    'messagePreferenceEvent','memberNote','memberMessage','pack','packCreditEvent','booking','charge','payment','acknowledgement',
    'intakeResponse','privacyRequest','staffAction','bookingAction','draft','approval','memberCheckin',
    'privacyErasurePreview','intakeTabletLaunch','waiverTabletLaunch','waiverLaunch','memberInvitation']);
  const owned=new Set(list(tx.state,'pack').filter(r=>r.personId===member.id).map(r=>r.id));
  const drafts=new Set(list(tx.state,'draft').filter(r=>r.personId===member.id).map(r=>r.id));
  const values=(value: unknown): unknown[]=>value&&typeof value==='object'?Object.values(value).flatMap(values):[value];
  const others=new Set(tx.state.people.filter(row=>row.id!==member.id).map(row=>row.id));
  const related=[...tx.state.records.values()].filter(({kind,data})=>values(data).includes(member.id)||kind==='packCreditEvent'&&owned.has(data.packId)||kind==='approval'&&drafts.has(data.draftId));
  const supported=(row: {kind:string;data:RecordData})=>kinds.has(row.kind)&&!values(row.data).some(value=>others.has(String(value)))
    &&(row.kind!=='draft'||['pack','reminder'].includes(row.data.type));
  const omitted: Record<string,number>={};
  for(const row of related.filter(row=>!supported(row)))omitted[row.kind]=(omitted[row.kind]??0)+1;
  const records=related.filter(supported).map(({kind,data}): {kind:string;data:RecordData}=>({kind,data:{id:data.id,...(
    kind==='memberCheckin'?{id:data.id,personId:member.id,phone:data.phone}:
    kind==='staffAction'?Object.fromEntries(['id','personId','command','actorId','actorRole','right','channel','at'].filter(key=>data[key]!==undefined).map(key=>[key,data[key]])):
    Object.fromEntries(Object.entries(structuredClone(data)).filter(([key])=>!['result','requestBasis'].includes(key))))}}));
  const documents=records.filter(row=>row.kind==='acknowledgement').map(row=>assembleWaiverEvidence(row.data,record(tx.state,row.data.waiverId,'waiver')));
  const forms=[...new Set(records.filter(row=>row.kind==='intakeResponse').map(row=>row.data.formId))].map(formId=>structuredClone(record(tx.state,formId,'intakeForm')));
  const custody=await tx.db.prepare("SELECT COUNT(*) AS count FROM (SELECT id FROM ik_provenance WHERE destination='strap:members' AND target_kind='member' AND target_id=? UNION SELECT id FROM ik_d1_history WHERE destination='strap:members' AND target_kind='member' AND target_id=?)").bind(member.id,member.id).first<{count:number}>();
  if(custody?.count)omitted.importCustody=custody.count;
  const coverage={nativeComplete:Object.keys(omitted).length===0,omitted};
  const bundle={format:'strap-native-member-access-v1',personId:member.id,profile:profileOf(tx.state,member),records,documents,forms,coverage,
    boundary:'Native member records for private owner review. Shared household records, original import artifacts, provider copies, membership agreement packages and shared signing evidence require separate review; no external delivery is performed.'};
  const exported={id:id(),digest:await privacyHash(JSON.stringify(bundle)),generatedAt:now(),personVersion:member.version,coverage};
  tx.put('privacyRequest',{...request,status:'exported',export:exported});
  return {id:request.id,personId:member.id,status:'exported',export:exported,bundle};
}

export function fulfillPrivacyAccess(tx: Transaction,input: Record<string,unknown>) {
  const {request,member}=verifiedPrivacyRequest(tx,input,'access');
  insist(request.status==='exported'&&request.export?.id===input.exportId,'privacy_export_review_required',409);
  insist(input.confirm===true,'privacy_delivery_confirmation_required');
  const status=request.export.coverage?.nativeComplete===true?'fulfilled':'partially-fulfilled';
  const fulfilled={...request,status,fulfilledAt:now(),fulfilledBy:tx.who.id,
    delivery:{exportId:request.export.id,digest:request.export.digest,channel:staffChannel(input),
      reference:text(input.deliveryReference,'deliveryReference',200),kind:'owner-recorded-delivery',scope:'native-member-copy',coverage:request.export.coverage}};
  tx.put('privacyRequest',fulfilled);
  return {id:request.id,personId:member.id,status,delivery:fulfilled.delivery,fulfilledAt:fulfilled.fulfilledAt};
}

/** Shared audit and replay keep the receipt, never a second copy of an export. */
export function privacyAuditResult(result: RecordData) {
  return Object.fromEntries(Object.entries(result).filter(([key])=>key!=='bundle')) as RecordData;
}
