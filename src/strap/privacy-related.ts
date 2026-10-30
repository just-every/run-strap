import { localDate } from './zone';
import { studioSettings } from './domain/studio';
import type { Person, RecordData, State } from './domain/types';

export const relationshipKinds=new Set('renewalSequencePreview household householdPayerChange familyTuition familyBillPreview familyInvoice familyTuitionWithdrawal memberMerge memberMergePreview makeupGuardian'.split(' '));
/** Shared ledgers keep their original allocations. Erasure never changes another payer's balance or authority. */
export function redactRelationship(kind:string,data:RecordData,member:Person,identities:string[],state:State,at:string,actorId:string) {
  const scrub=(value:any):any=>Array.isArray(value)?value.map(scrub):value&&typeof value==='object'
    ? Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
      value.personId===member.id&&['name','reason','authorizationEvidence','adultOn','adultAt'].includes(key)?null:scrub(item)]))
    :typeof value==='string'&&identities.some(identity=>value.toLowerCase().includes(identity.toLowerCase()))?'[erased]':value;
  const saved={...scrub(data),privacyRedactedAt:at};
  if(kind==='renewalSequencePreview')Object.assign(saved,{audience:data.audience.filter((row:RecordData)=>row.personId!==member.id),status:'retired',key:null});
  if(kind==='household') {
    saved.name=saved.name||'Retained household';
    saved.guardianIds=data.guardianIds.filter((key:string)=>key!==member.id);
    saved.participantIds=data.participantIds.filter((key:string)=>key!==member.id);
    saved.guardianEvidence=Object.fromEntries(Object.entries(saved.guardianEvidence).filter(([key])=>key!==member.id));
    if(data.payerId===member.id)saved.payerId=null;
    if(data.pendingPayer?.personId===member.id)saved.pendingPayer=null;
    saved.removedGuardians=(saved.removedGuardians??[]).map((row:RecordData)=>row.personId===member.id?{personId:member.id,removedAt:row.removedAt,removedBy:row.removedBy}:row);
    if(!saved.guardianIds.length&&!saved.participantIds.length&&!saved.payerId)Object.assign(saved,{name:'Erased household',contacts:[],pendingPayer:null});
    saved.revision=data.revision+1;
  }
  if(kind==='familyTuition') {
    const month=localDate(at,studioSettings(state)?.timeZone??'UTC').slice(0,7);
    saved.rows=saved.rows.map((row:RecordData)=>row.personId===member.id?{...row,name:'Erased person',endsMonth:row.endsMonth<month?row.endsMonth:month}:row);
    if(data.payerId===member.id)saved.endsMonth=data.endsMonth<month?data.endsMonth:month;
    saved.revision=data.revision+1;
  }
  if(kind==='familyBillPreview')Object.assign(saved,{status:'retired',key:null,basis:null});
  if(kind==='memberMergePreview')return {id:data.id,personId:data.personId,sourceId:data.sourceId,targetId:data.targetId,status:'retired',mergeId:data.mergeId??null,createdAt:data.createdAt,createdBy:data.createdBy,privacyRedactedAt:at};
  if(kind==='memberMerge') {
    if(data.sourceId===member.id)saved.sourceIdentity={name:'Erased person',email:null,phone:null,emergencyContact:null};
    if(data.targetId===member.id)saved.targetIdentity={name:'Erased person',email:null,phone:null,emergencyContact:null};
    saved.reason=null;
  }
  if(kind==='makeupGuardian')Object.assign(saved,{revokedAt:data.revokedAt??at,revokedBy:actorId,authorizationEvidence:null,adultOn:null,adultAt:null});
  return saved;
}
