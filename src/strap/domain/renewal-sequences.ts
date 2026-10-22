import { humanOwner, id, insist, integer, list, now, record, text, type State } from './types';
import type { Transaction } from './store';
import { channels, permission, preferencesOf, suppressMarketing, type MarketingChannel } from './preferences';
import { renewalWorklist } from './renewals';

/** Queue enforcement only. This module has no external provider transport or credentials. */
export function inQuietHours(state:State,personId:string,at=now()) {
  const p=preferencesOf(state,personId),parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:p.timeZone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
  const minute=Number(parts.hour)*60+Number(parts.minute),minutes=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3)),start=minutes(p.quietStart),end=minutes(p.quietEnd);
  return minute<600 || minute>=1200 || (start<end ? minute>=start&&minute<end : minute>=start||minute<end);
}
const worklist=(tx:Transaction)=>renewalWorklist(tx.state,tx.who,new URLSearchParams()).rows;
export function prepareRenewalSequence(tx:Transaction,input:Record<string,unknown>) {
  humanOwner(tx.who);const channel=text(input.channel,'channel',10) as MarketingChannel;insist(channels.includes(channel),'invalid_channel');
  const preview={id:id(),name:text(input.name,'name',100),channel,text:text(input.text,'message',2000),maxMessages:integer(input.maxMessages,'maxMessages',1,1000),
    status:'preview',createdAt:now(),createdBy:tx.who.id,version:tx.state.version+1,
    audience:worklist(tx).map(r=>({packId:r.packId,personId:r.personId,member:r.member,permission:permission(tx.state,r.personId,channel)}))};
  const saved={...preview,key:id()};tx.put('renewalSequencePreview',saved);return saved;
}
export function approveRenewalSequence(tx:Transaction,input:Record<string,unknown>) {
  humanOwner(tx.who);const p=record(tx.state,input.id,'renewalSequencePreview');
  insist(p.createdBy===tx.who.id && p.key===input.key,'sequence_preview_changed',409);
  const prior=list(tx.state,'renewalSequence').find(r=>r.previewId===p.id);if(prior)return prior;
  insist(tx.state.version===p.version,'sequence_audience_changed',409);
  const saved={id:id(),previewId:p.id,name:p.name,channel:p.channel,text:p.text,maxMessages:p.maxMessages,enabled:true,approvedAt:now(),approvedBy:tx.who.id};
  tx.put('renewalSequence',saved);tx.put('renewalSequencePreview',{...p,status:'approved',sequenceId:saved.id});return saved;
}
export function setRenewalSequence(tx:Transaction,input:Record<string,unknown>) {
  humanOwner(tx.who);const sequence=record(tx.state,input.id,'renewalSequence');insist(typeof input.enabled==='boolean','invalid_enabled');
  const saved={...sequence,enabled:input.enabled,updatedAt:now(),updatedBy:tx.who.id};tx.put('renewalSequence',saved);return saved;
}
export function enrollRenewalSequence(tx:Transaction,input:Record<string,unknown>) {
  humanOwner(tx.who);const sequence=record(tx.state,input.sequenceId,'renewalSequence'),pack=record(tx.state,input.packId,'pack');
  insist(sequence.enabled,'sequence_paused',409);
  const key=`marketing-message:${sequence.id}:${pack.id}`,prior=tx.state.records.get(key)?.data;if(prior)return prior;
  const row=worklist(tx).find(r=>r.packId===pack.id);insist(row && input.basis===row.basis,'renewal_worklist_changed',409);
  const denied=permission(tx.state,pack.personId,sequence.channel);insist(!denied,denied ?? 'permission_denied',409);
  insist(list(tx.state,'marketingMessage').filter(m=>m.sequenceId===sequence.id).length<sequence.maxMessages,'sequence_budget_exhausted',409);
  const saved={id:key,personId:pack.personId,packId:pack.id,sequenceId:sequence.id,channel:sequence.channel,text:sequence.text,status:'queued',createdAt:now(),createdBy:tx.who.id};
  tx.put('marketingMessage',saved);return saved;
}
/** Explicit native owner review. SMS/email remain held: no provider transport is claimed. */
export function reviewRenewalQueue(tx:Transaction) {
  humanOwner(tx.who);const rows=worklist(tx),at=now();
  for(const message of list(tx.state,'marketingMessage').filter(m=>['queued','held'].includes(m.status))) {
    const denied=permission(tx.state,message.personId,message.channel);
    if(denied){suppressMarketing(tx,message.personId,message.channel,denied);continue;}
    if(!rows.some(r=>r.packId===message.packId)){tx.put('marketingMessage',{...message,status:'suppressed',holdReason:null,suppressionReason:'source_no_longer_eligible',suppressedAt:at});continue;}
    const sequence=record(tx.state,message.sequenceId,'renewalSequence');
    const held=!sequence.enabled?'sequence_paused':inQuietHours(tx.state,message.personId,at)?'quiet_hours':message.channel!=='inApp'?'provider_delivery_unavailable':null;
    if(held){tx.put('marketingMessage',{...message,status:'held',holdReason:held});continue;}
    tx.put('memberMessage',{id:'in-app:'+message.sequenceId+':'+message.packId,marketingMessageId:message.id,personId:message.personId,text:message.text,at,actorId:tx.who.id,actorRole:'owner',staffMade:true,channel:'in-app-marketing',sequenceId:sequence.id});
    tx.put('marketingMessage',{...message,status:'delivered',holdReason:null,deliveredAt:at,outcome:'in-app-recorded'});
  }
  return {id:id(),messages:list(tx.state,'marketingMessage')};
}
