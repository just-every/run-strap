import { load, Transaction } from './domain/store';
import { humanOwner, id, insist, list, now, person, record, text, type Actor, type RecordData, type State } from './domain/types';
import { hasStaffRight } from './domain/staff-rights';
import { profileOf } from './domain/profiles';
import { eraseUsedMember, erasureReview } from './privacy-erasure';
import { sha256 } from '../modules/import-kit/src/d1/index';

const channels = ['desk','phone','inbox'] as const;
export function privacyAuthority(state: State, who: Actor) {
  humanOwner(who);
  insist(hasStaffRight(state,who,'privacy'),'privacy_right_required',403);
}
function audit(tx: Transaction, command: string, request: RecordData, before: unknown, after: unknown) {
  tx.put('staffAction',{id:id(),action:command,command,personId:request.personId,actorId:tx.who.id,actorRole:tx.who.role,
    staffMade:true,right:'privacy',channel:request.channel,before:before?{privacy:true,...before as object}:null,after:{privacy:true,...after as object},reason:null,at:now()});
}
export function privacySnapshot(state: State, who: Actor) {
  if (who.role !== 'owner' || !who.isOwner) return null;
  return {requests:list(state,'privacyRequest'),reviews:list(state,'privacyReview'),receipts:list(state,'privacyReceipt'),
    retained:list(state,'privacyRetention').map(({content:_,...row})=>row)};
}
export function verifiedRequest(state: State, key: unknown, kind: string) {
  const request=record(state,key,'privacyRequest');
  insist(request.type===kind,'privacy_request_type',409);
  insist(request.verifiedAt && request.status!=='erased','privacy_identity_verification_required',409);
  const member=person(state,request.personId,false);
  insist(member.version===request.personVersion,'privacy_identity_changed',409);
  insist(request.identityBasis===sha256(JSON.stringify(profileOf(state,member))),'privacy_identity_changed',409);
  return {request,member};
}
/** The downloaded evidence contains this member's records, never a stored export or a reusable credential. */
export function accessBundle(state: State, memberId: string) {
  const member=person(state,memberId,false);
  const selected=[...state.records.values()].filter(r=>r.data.personId===memberId &&
    !['privacyRetention','privacyReview','privacyRequest','staffAccess','memberRecordGrant','memberInvitation'].includes(r.kind));
  const clean=(value: any): any => Array.isArray(value)?value.map(clean):value&&typeof value==='object'
    ? Object.fromEntries(Object.entries(value).filter(([key])=>!/(secret|token|requestBasis|result|^key$|Url$)/i.test(key)).map(([key,item])=>[key,clean(item)])):value;
  return {format:'strap-member-access',version:1,generatedAt:now(),person:{id:member.id,...profileOf(state,member)},
    records:selected.map(({kind,data})=>({kind,data:clean(data)})),
    documents:list(state,'acknowledgement').filter(a=>a.personId===memberId).map(a=>({receipt:clean(a),document:state.records.get(a.waiverId)?.data ?? null})),
    boundary:'This copy contains the member records held by this studio. External providers and copies already delivered remain outside this installation.'};
}
/** Privacy work is deliberately independent of scheduled invoices, notices and other command side effects. */
export async function privacyCommand(db: D1Database, who: Actor, name: string, input: Record<string,unknown>) {
  const loaded=await load(db,who); privacyAuthority(loaded.state,loaded.who);
  const tx=new Transaction(db,loaded.state,loaded.who), at=now();
  if (name==='privacy.request') {
    const member=person(tx.state,input.personId,false); insist(member.role==='member','member_required');
    const type=text(input.type,'type',20), channel=text(input.channel,'channel',20), requestId=text(input.requestId,'requestId',100);
    insist(['access','erasure'].includes(type),'invalid_privacy_request_type');
    insist(channels.includes(channel as typeof channels[number]),'invalid_channel');
    const prior=list(tx.state,'privacyRequest').find(r=>r.requestId===requestId && r.createdBy===who.id);
    if(prior){insist(prior.personId===member.id && prior.type===type && prior.channel===channel,'privacy_request_changed',409);return prior;}
    const saved={id:id(),personId:member.id,personVersion:member.version,type,channel,requestId,status:'requested',createdAt:at,createdBy:who.id};
    tx.put('privacyRequest',saved);audit(tx,name,saved,null,{id:saved.id,status:saved.status});await tx.commit();return saved;
  }
  if(name==='privacy.verify') {
    const request=record(tx.state,input.id,'privacyRequest'),member=person(tx.state,request.personId,false);
    insist(request.status==='requested','privacy_request_already_verified',409);
    insist(input.confirm===true,'privacy_identity_confirmation_required');
    const method=text(input.method,'method',40);
    insist(['in-person-document','callback-on-file','signed-in-member'].includes(method),'invalid_verification_method');
    const saved={...request,personVersion:member.version,identityBasis:sha256(JSON.stringify(profileOf(tx.state,member))),status:'verified',verifiedAt:at,verifiedBy:who.id,verificationMethod:method};
    tx.put('privacyRequest',saved);audit(tx,name,saved,{status:request.status},{status:saved.status,method});await tx.commit();return saved;
  }
  if(name==='privacy.export') {
    const {request,member}=verifiedRequest(tx.state,input.id,'access');
    insist(['verified','exported','delivered'].includes(request.status),'privacy_request_not_verified',409);
    const bundle=accessBundle(tx.state,member.id);
    if(request.status==='verified') {
      tx.put('privacyRequest',{...request,status:'exported',exportedAt:at,exportedBy:who.id});
      audit(tx,name,request,{status:request.status},{status:'exported',delivery:'owner-download'});await tx.commit();
    }
    return bundle;
  }
  if(name==='privacy.deliver') {
    const {request}=verifiedRequest(tx.state,input.id,'access');
    insist(request.status==='exported','privacy_download_required',409);
    insist(input.confirm===true,'privacy_delivery_confirmation_required');
    const delivery=text(input.delivery,'delivery',30);
    insist(['in-person','secure-transfer'].includes(delivery),'invalid_privacy_delivery');
    const saved={...request,status:'delivered',deliveredAt:at,deliveredBy:who.id,delivery};
    tx.put('privacyRequest',saved);audit(tx,name,request,{status:'exported'},{status:'delivered',delivery});await tx.commit();return saved;
  }
  if(name==='privacy.retained') {
    const retained=record(tx.state,input.id,'privacyRetention');
    return {format:'strap-retained-evidence',...retained};
  }
  if(name==='privacy.erase.prepare') {
    const {request,member}=verifiedRequest(tx.state,input.id,'erasure');
    const review=erasureReview(tx.state,member,input);
    const saved={id:id(),personId:member.id,requestId:request.id,version:tx.state.version+1,...review,createdAt:at,createdBy:who.id};
    tx.put('privacyReview',saved);audit(tx,name,request,null,{reviewId:saved.id,obligations:review.obligations,retention:review.retention});
    await tx.commit();return saved;
  }
  if(name==='privacy.erase.confirm') {
    const review=record(tx.state,input.id,'privacyReview');
    const {request,member}=verifiedRequest(tx.state,review.requestId,'erasure');
    insist(input.confirm===true,'privacy_erasure_confirmation_required');
    insist(review.createdBy===who.id && review.version===tx.state.version,'privacy_review_changed',409);
    return eraseUsedMember(db,tx,request,review,member);
  }
  if(name==='privacy.hold.release' || name==='privacy.dispose') {
    const retained=record(tx.state,input.id,'privacyRetention');
    insist(input.confirm===true,'privacy_confirmation_required');
    if(name==='privacy.hold.release') {
      insist(retained.hold && !retained.hold.releasedAt,'privacy_hold_not_active',409);
      const reason=text(input.reason,'reason',500);
      tx.put('privacyRetention',{...retained,hold:{...retained.hold,releasedAt:at,releasedBy:who.id,releaseReason:reason}});
      audit(tx,name,{...retained,channel:'desk'},null,{retentionId:retained.id,releasedAt:at});
    } else {
      insist(!retained.hold || retained.hold.releasedAt,'privacy_hold_active',409);
      insist(Date.parse(retained.retainUntil)<=Date.now(),'privacy_retention_not_due',409);
      tx.reached(retained.retainUntil);
      // A fresh checkpoint is required whenever retained identifying evidence is disposed.
      const { disposeRetention }=await import('./privacy-erasure');
      await disposeRetention(tx,retained);
      audit(tx,name,{...retained,channel:'desk'},null,{retentionId:retained.id,disposedAt:at});
    }
    await tx.commit();return {id:retained.id,completed:true};
  }
  insist(false,'unknown_privacy_command',404);
}
