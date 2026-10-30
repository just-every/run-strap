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
  const kinds=['memberProfile','profileChange','memberPreference','memberPreferenceEvent','messagePreference',
    'messagePreferenceEvent','memberNote','memberMessage','pack','packCreditEvent','booking','charge','payment','acknowledgement',
    'intakeResponse','privacyRequest'];
  const owned=new Set(list(tx.state,'pack').filter(r=>r.personId===member.id).map(r=>r.id));
  const records=[...tx.state.records.values()].filter(r=>kinds.includes(r.kind)&&(r.data.personId===member.id||r.kind==='packCreditEvent'&&owned.has(r.data.packId)))
    .map(({kind,data})=>({kind,data:kind==='profileChange'?Object.fromEntries(Object.entries(data).filter(([key])=>!['result','requestBasis'].includes(key))):structuredClone(data)}));
  const documents=list(tx.state,'acknowledgement').filter(row=>row.personId===member.id).map(row=>assembleWaiverEvidence(row,record(tx.state,row.waiverId,'waiver')));
  const forms=[...new Set(records.filter(row=>row.kind==='intakeResponse').map(row=>row.data.formId))].map(formId=>structuredClone(record(tx.state,formId,'intakeForm')));
  const bundle={format:'strap-native-member-access-v1',personId:member.id,profile:profileOf(tx.state,member),records,documents,forms,
    boundary:'Native member records for private owner review. Shared household records, original import artifacts, provider copies and membership agreement packages and shared signing evidence require separate review; no external delivery is performed.'};
  const exported={id:id(),digest:await privacyHash(JSON.stringify(bundle)),generatedAt:now(),personVersion:member.version};
  tx.put('privacyRequest',{...request,status:'exported',export:exported});
  return {id:request.id,personId:member.id,status:'exported',export:exported,bundle};
}

export function fulfillPrivacyAccess(tx: Transaction,input: Record<string,unknown>) {
  const {request,member}=verifiedPrivacyRequest(tx,input,'access');
  insist(request.status==='exported'&&request.export?.id===input.exportId,'privacy_export_review_required',409);
  insist(input.confirm===true,'privacy_delivery_confirmation_required');
  const fulfilled={...request,status:'fulfilled',fulfilledAt:now(),fulfilledBy:tx.who.id,
    delivery:{exportId:request.export.id,digest:request.export.digest,channel:staffChannel(input),
      reference:text(input.deliveryReference,'deliveryReference',200),kind:'owner-recorded-delivery'}};
  tx.put('privacyRequest',fulfilled);
  return {id:request.id,personId:member.id,status:'fulfilled',delivery:fulfilled.delivery,fulfilledAt:fulfilled.fulfilledAt};
}

/** Shared audit and replay keep the receipt, never a second copy of an export. */
export function privacyAuditResult(result: RecordData) {
  return Object.fromEntries(Object.entries(result).filter(([key])=>key!=='bundle')) as RecordData;
}
