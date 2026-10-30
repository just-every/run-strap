import { list, now, person, type RecordData, type State } from './domain/types';
import { profileOf } from './domain/profiles';

const internal=new Set('privacyRetention privacyReview privacyRequest staffAccess memberRecordGrant memberInvitation memberMergePreview familyBillPreview billingOperation billingSetup billingActionLaunch'.split(' '));
const audits=new Set('staffAction bookingAction staffAccessEvent'.split(' '));
const auditFields=new Set('id personId action command actorId actorRole staffMade right channel at createdAt changed'.split(' '));
/** Access copies contain personal records, not replay keys, provider credentials or another household member's profile. */
function clean(value:any):any {
  if(Array.isArray(value))return value.map(clean);
  if(!value || typeof value!=='object')return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!/(secret|token|requestBasis|result|^key$|^basis$|Url$|paymentMethodId|setupIntentId|provider.*Id|^provider$|paymentIntentId|customerId|inputHash)/i.test(key)).map(([key,item])=>[key,clean(item)]));
}
function familyCopy(data:RecordData,memberId:string) {
  const rows=(data.rows??[]).filter((row:RecordData)=>row.personId===memberId);
  return clean({id:data.id,personId:memberId,planId:data.planId,month:data.month,service:data.service,startsMonth:data.startsMonth,endsMonth:data.endsMonth,
    rows,amountCents:data.personId===memberId?data.amountCents:rows.reduce((sum:number,row:RecordData)=>sum+(row.netCents??row.amountCents??0),0),
    termStartAt:data.termStartAt,termEndAt:data.termEndAt,policy:data.policy,acceptedAt:data.acceptedAt,createdAt:data.createdAt,
    role:data.personId===memberId?'payer':'participant'});
}
export function accessBundle(state:State,memberId:string) {
  const member=person(state,memberId,false), records:Array<{kind:string;data:RecordData}>=[];
  for(const {kind,data} of state.records.values()) {
    if(internal.has(kind))continue;
    if(['familyTuition','familyInvoice'].includes(kind)) {
      if(data.personId===memberId || data.rows.some((row:RecordData)=>row.personId===memberId))records.push({kind,data:familyCopy(data,memberId)});
      continue;
    }
    if(kind==='memberMerge') {
      if(data.sourceId===memberId || data.targetId===memberId)records.push({kind,data:{id:data.id,personId:memberId,at:data.at,authorityTransferred:false,role:data.sourceId===memberId?'source':'retained'}});
      continue;
    }
    if(data.personId!==memberId)continue;
    const visible=kind==='payment'&&data.collection==='stripe-test-checkout'?{...data,reference:'Recorded payment '+data.id}:data;
    records.push({kind,data:clean(audits.has(kind)?Object.fromEntries(Object.entries(data).filter(([key])=>auditFields.has(key))):visible)});
  }
  return {format:'strap-member-access',version:1,generatedAt:now(),person:{id:member.id,...profileOf(state,member)},records,
    documents:list(state,'acknowledgement').filter(a=>a.personId===memberId).map(a=>({receipt:clean(a),document:clean(state.records.get(a.waiverId)?.data??null)})),
    boundary:'This copy contains the member records held by this studio. Shared records include only this person’s details and allocations. External providers and copies already delivered remain outside this installation.'};
}
